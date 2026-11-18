import asyncio
import importlib.util
from itertools import product
from pathlib import Path
import uuid

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from httpx2 import AsyncClient
import pytest
from sqlalchemy import delete, func, inspect, select
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncEngine, AsyncSession

from core.polls import vote_in_poll
from core.security import create_access_token
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from db.dao.poll_dao import PollDao
from db.dao.user_dao import UserDao
from db.models import Chat, Message, Poll, PollOption, PollVote, User
from infrastructure.redis.client import Redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.message import MessageInternalDTO
from schemas.websockets import WsEvent


def authorization(user_id: uuid.UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user_id)})}"}


@pytest.mark.parametrize("anonymous,retract,quiz", list(product([False, True], repeat=3)))
async def test_poll_modes_privacy_quiz_and_vote_rules(
    anonymous: bool,
    retract: bool,
    quiz: bool,
    db_session: AsyncSession,
    db_user: User,
    db_userchat: tuple[Chat, User],
    api_client: AsyncClient,
    test_redis_client: Redis,
) -> None:
    chat, member = db_userchat
    await ChatDao.add_users_to_chat(db_session, chat.id, [db_user.id])
    created = await api_client.post(
        f"/api/v1/chats/{chat.id}/polls",
        headers=authorization(db_user.id),
        json={
            "question": "Какой ответ верный?",
            "options": ["Первый", "Второй"],
            "is_anonymous": anonymous,
            "allow_retract": retract,
            "is_quiz": quiz,
            "correct_option_index": 1 if quiz else None,
        },
    )
    assert created.status_code == 201, created.text
    message = created.json()
    poll_id = message["poll_id"]
    assert poll_id is not None
    assert (
        await MessageDao.get_with_attachments(db_session, uuid.UUID(message["id"]))
    ).poll_id == uuid.UUID(poll_id)
    headers = authorization(member.id)
    url = f"/api/v1/polls/{poll_id}"
    before = (await api_client.get(url, headers=headers)).json()
    assert before["correct_option_id"] is None
    assert before["my_option_id"] is None
    assert before["total_votes"] == 0
    options = before["options"]
    async with test_redis_client.pubsub() as subscriber:
        await subscriber.subscribe(f"chat:{chat.id}")
        await subscriber.get_message(timeout=1)
        voted = await api_client.put(
            f"{url}/vote", headers=headers, json={"option_id": options[0]["id"]}
        )
        assert voted.status_code == 200, voted.text
        event = await subscriber.get_message(ignore_subscribe_messages=True, timeout=2)
        notification = WsEvent.model_validate_json(event["data"])
        assert notification.event == "poll:updated"
        assert set(notification.data.model_dump()) == {
            "chat_id",
            "poll_id",
            "message_id",
            "version",
        }
    answer = voted.json()
    assert answer["my_option_id"] == options[0]["id"]
    assert answer["correct_option_id"] == (options[1]["id"] if quiz else None)
    assert answer["total_votes"] == 1
    assert answer["options"][0]["votes_count"] == 1
    creator_view = (await api_client.get(url, headers=authorization(db_user.id))).json()
    assert creator_view["my_option_id"] is None
    if anonymous:
        assert all(option["voters"] is None for option in creator_view["options"])
        assert str(member.id) not in str(creator_view)
        assert member.username not in str(creator_view)
    else:
        assert creator_view["options"][0]["voters"] == [
            {"id": str(member.id), "username": member.username, "tag": member.tag}
        ]
    repeated = await api_client.put(
        f"{url}/vote", headers=headers, json={"option_id": options[0]["id"]}
    )
    assert repeated.status_code == 200
    assert repeated.json()["total_votes"] == 1
    changed = await api_client.put(
        f"{url}/vote", headers=headers, json={"option_id": options[1]["id"]}
    )
    assert changed.status_code == (200 if retract else 409)
    cancelled = await api_client.delete(f"{url}/vote", headers=headers)
    assert cancelled.status_code == (200 if retract else 409)
    final = (await api_client.get(url, headers=headers)).json()
    assert final["total_votes"] == (0 if retract else 1)
    assert final["my_option_id"] == (None if retract else options[0]["id"])
    assert await db_session.scalar(select(func.count()).select_from(PollVote)) == (
        0 if retract else 1
    )
    dao_poll = await PollDao.get(db_session, uuid.UUID(poll_id))
    assert dao_poll.question == "Какой ответ верный?"
    history = await api_client.get(f"/api/v1/chats/{chat.id}/messages", headers=headers)
    assert (
        next(item for item in history.json()["messages"] if item["id"] == message["id"])[
            "poll_id"
        ]
        == poll_id
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"question": " ", "options": ["a", "b"]},
        {"question": "q", "options": ["one"]},
        {"question": "q", "options": ["One", " one "]},
        {"question": "q", "options": ["", "b"]},
        {"question": "q", "options": ["a", "b"], "is_quiz": True},
        {
            "question": "q",
            "options": ["a", "b"],
            "is_quiz": True,
            "correct_option_index": 2,
        },
        {"question": "q", "options": ["a", "b"], "correct_option_index": 0},
    ],
)
async def test_invalid_poll_definitions_are_rejected(
    payload: dict[str, object],
    db_userchat: tuple[Chat, User],
    api_client: AsyncClient,
) -> None:
    chat, member = db_userchat
    response = await api_client.post(
        f"/api/v1/chats/{chat.id}/polls", headers=authorization(member.id), json=payload
    )
    assert response.status_code == 422


async def test_poll_membership_wrong_option_and_message_lifecycle(
    db_session: AsyncSession,
    db_userchat: tuple[Chat, User],
    api_client: AsyncClient,
) -> None:
    chat, member = db_userchat
    headers = authorization(member.id)
    payload = {"question": "Question", "options": ["A", "B"]}
    first = (
        await api_client.post(
            f"/api/v1/chats/{chat.id}/polls", headers=headers, json=payload
        )
    ).json()
    second = (
        await api_client.post(
            f"/api/v1/chats/{chat.id}/polls", headers=headers, json=payload
        )
    ).json()
    url = f"/api/v1/polls/{first['poll_id']}"
    second_poll = (
        await api_client.get(f"/api/v1/polls/{second['poll_id']}", headers=headers)
    ).json()
    wrong_option = await api_client.put(
        f"{url}/vote",
        headers=headers,
        json={"option_id": second_poll["options"][0]["id"]},
    )
    assert wrong_option.status_code == 422
    outsider = authorization(uuid.uuid4())
    assert (await api_client.get(url, headers=outsider)).status_code == 403
    assert (
        await api_client.put(
            f"{url}/vote",
            headers=outsider,
            json={"option_id": second_poll["options"][0]["id"]},
        )
    ).status_code == 403
    assert (await api_client.delete(f"{url}/vote", headers=outsider)).status_code == 403
    assert (
        await api_client.post(
            f"/api/v1/chats/{chat.id}/polls", headers=outsider, json=payload
        )
    ).status_code == 403
    assert (
        await api_client.get(f"/api/v1/polls/{uuid.uuid4()}", headers=headers)
    ).status_code == 404
    edited = await api_client.put(
        f"/api/v1/messages/{first['id']}", headers=headers, json={"text": "Changed"}
    )
    assert edited.status_code == 422
    forwarded = await api_client.post(
        f"/api/v1/chats/{chat.id}/messages/{first['id']}/forward",
        headers=headers,
        json={"target_chat_id": str(chat.id)},
    )
    assert forwarded.status_code == 422
    deleted = await api_client.delete(f"/api/v1/messages/{first['id']}", headers=headers)
    assert deleted.status_code == 200
    assert (await api_client.get(url, headers=headers)).status_code == 404
    assert await db_session.scalar(select(func.count()).select_from(Poll)) == 1
    assert await db_session.scalar(select(func.count()).select_from(PollOption)) == 2


async def test_polls_in_queued_threads_survive_the_normal_worker_persistence(
    db_session: AsyncSession,
    db_userchat: tuple[Chat, User],
    api_client: AsyncClient,
    test_redis_client: Redis,
) -> None:
    chat, member = db_userchat
    root = MessageInternalDTO(
        id=uuid.uuid4(),
        chat_id=chat.id,
        user_id=member.id,
        text="Queued root",
        attachments=[],
    )
    await RedisDao.enqueue_message(test_redis_client, root)
    created = await api_client.post(
        f"/api/v1/chats/{chat.id}/polls",
        headers=authorization(member.id),
        json={
            "question": "Poll in thread",
            "options": ["A", "B"],
            "thread_root_id": str(root.id),
        },
    )
    assert created.status_code == 201, created.text
    await MessageDao.bulk_insert_messages(db_session, [root])
    await MessageDao.attach_queued_attachments(db_session, [root])
    thread = await api_client.get(
        f"/api/v1/chats/{chat.id}/messages/{root.id}/thread",
        headers=authorization(member.id),
    )
    assert thread.status_code == 200
    assert {item["id"] for item in thread.json()["messages"]} == {
        str(root.id),
        created.json()["id"],
    }
    assert (
        next(
            item
            for item in thread.json()["messages"]
            if item["id"] == created.json()["id"]
        )["poll_id"]
        == created.json()["poll_id"]
    )


async def test_concurrent_first_answers_cannot_bypass_an_irreversible_vote(
    db_engine: AsyncEngine,
    test_redis_client: Redis,
) -> None:
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex
    async with sessions.begin() as session:
        user = await UserDao.add(
            session,
            {
                "username": f"concurrent-{suffix}",
                "email": f"{suffix}@example.test",
                "password": "test-only",
            },
        )
        user_id = user.id
        chat = await ChatDao.add(
            session,
            {"owner_id": user_id, "title": f"poll-{suffix}", "description": "test"},
        )
        chat_id = chat.id
        await ChatDao.add_users_to_chat(session, chat_id, [user_id])
        message = await MessageDao.create_with_attachments(
            session,
            {"chat_id": chat_id, "user_id": user_id, "text": "Concurrent vote"},
            [],
        )
        poll = await PollDao.create(
            session,
            message_id=message.id,
            chat_id=chat_id,
            creator_id=user_id,
            question="Concurrent vote",
            options=["A", "B"],
            is_anonymous=True,
            allow_retract=False,
            is_quiz=False,
            correct_option_index=None,
        )
        poll_id = poll.id
        options = [option.id for option in poll.options]
    try:

        async def answer(option_id: uuid.UUID) -> int:
            async with sessions.begin() as session:
                try:
                    await vote_in_poll(
                        session, test_redis_client, poll_id, user_id, option_id
                    )
                    return 200
                except HTTPException as error:
                    return error.status_code

        assert sorted(await asyncio.gather(*(answer(option) for option in options))) == [
            200,
            409,
        ]
        async with sessions.begin() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(PollVote)
                    .where(PollVote.poll_id == poll_id)
                )
                == 1
            )
    finally:
        async with sessions.begin() as session:
            await session.execute(delete(Message).where(Message.chat_id == chat_id))
            await session.execute(delete(Chat).where(Chat.id == chat_id))
            await session.execute(delete(User).where(User.id == user_id))


async def test_poll_migration_round_trip_in_the_test_database(
    db_engine: AsyncEngine,
) -> None:
    migration_path = (
        Path(__file__).resolve().parents[3]
        / "alembic/versions/e8c2a490b517_chat_polls.py"
    )
    spec = importlib.util.spec_from_file_location("poll_migration", migration_path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def round_trip(connection: Connection) -> None:
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
            assert not {"polls", "poll_options", "poll_votes"} & set(
                inspect(connection).get_table_names()
            )
            migration.upgrade()
            assert {"polls", "poll_options", "poll_votes"} <= set(
                inspect(connection).get_table_names()
            )
            constraints = inspect(connection).get_unique_constraints("poll_votes")
            assert any(
                item["column_names"] == ["poll_id", "user_id"] for item in constraints
            )

    async with db_engine.begin() as connection:
        await connection.run_sync(round_trip)

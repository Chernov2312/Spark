import uuid

import pytest

from db.dao.exceptions import DuplicateResourceError
from db.dao.social_dao import SocialDao


async def test_friendship_categories_and_requests(db_session, db_user, db_userchat):
    _, friend = db_userchat
    low_id, high_id = sorted((db_user.id, friend.id), key=str)

    assert await SocialDao.get_user(db_session, db_user.id) == db_user
    assert await SocialDao.get_user(db_session, uuid.uuid4()) is None
    friendship = await SocialDao.add_friendship(
        db_session,
        user_low_id=low_id,
        user_high_id=high_id,
        requested_by_id=low_id,
    )
    assert (
        await SocialDao.get_friendship(db_session, low_id, high_id)
    ).id == friendship.id
    assert (
        await SocialDao.get_other_friend(db_session, friendship, db_user.id)
    ).id == friend.id
    assert (
        await SocialDao.get_other_friend(db_session, friendship, friend.id)
    ).id == db_user.id

    incoming = await SocialDao.list_friendships(
        db_session,
        high_id,
        status="pending",
        incoming_only=True,
    )
    outgoing = await SocialDao.list_friendships(
        db_session,
        low_id,
        status="pending",
        requested_by_id=low_id,
    )
    assert [row.id for row in incoming] == [friendship.id]
    assert [row.id for row in outgoing] == [friendship.id]
    assert (
        await SocialDao.list_friendships(
            db_session,
            low_id,
            status="accepted",
        )
        == []
    )

    category = await SocialDao.add_friend_category(
        db_session,
        owner_id=db_user.id,
        name="work",
        color="#123abc",
    )
    with pytest.raises(DuplicateResourceError):
        async with db_session.begin_nested():
            await SocialDao.add_friend_category(
                db_session,
                owner_id=db_user.id,
                name="work",
                color="#123abc",
            )
    assert [
        row.id
        for row in await SocialDao.list_friend_categories(
            db_session,
            db_user.id,
        )
    ] == [category.id]
    assert (
        await SocialDao.get_friend_category_id(
            db_session,
            friendship.id,
            db_user.id,
        )
        is None
    )
    assert (
        await SocialDao.set_friend_category(
            db_session,
            friendship.id,
            db_user.id,
            category.id,
        )
        is True
    )
    assert (
        await SocialDao.get_friend_category_id(
            db_session,
            friendship.id,
            db_user.id,
        )
        == category.id
    )
    assert (
        await SocialDao.set_friend_category(
            db_session,
            friendship.id,
            db_user.id,
            uuid.uuid4(),
        )
        is False
    )
    assert (
        await SocialDao.get_friend_category_id(
            db_session,
            friendship.id,
            db_user.id,
        )
        == category.id
    )
    assert (
        await SocialDao.set_friend_category(
            db_session,
            friendship.id,
            db_user.id,
            None,
        )
        is True
    )
    assert (
        await SocialDao.get_friend_category_id(
            db_session,
            friendship.id,
            db_user.id,
        )
        is None
    )

    accepted = await SocialDao.update_friendship(
        db_session,
        friendship.id,
        status="accepted",
    )
    assert accepted.status == "accepted"
    assert (
        await SocialDao.update_friendship(db_session, uuid.uuid4(), status="declined")
        is None
    )
    assert [
        row.id
        for row in await SocialDao.list_friendships(
            db_session,
            db_user.id,
            status="accepted",
        )
    ] == [friendship.id]


async def test_chat_folders_and_default_groups(db_session, db_user, db_userchat):
    chat, member = db_userchat
    assert await SocialDao.is_chat_member(db_session, chat.id, member.id) is True
    assert await SocialDao.is_chat_member(db_session, chat.id, db_user.id) is False

    folder = await SocialDao.add_chat_folder(
        db_session,
        owner_id=member.id,
        name="friends",
        color="#aabbcc",
    )
    assert (
        await SocialDao.get_owned_chat_folder(
            db_session,
            folder.id,
            member.id,
        )
        == folder
    )
    assert (
        await SocialDao.get_owned_chat_folder(
            db_session,
            folder.id,
            db_user.id,
        )
        is None
    )
    await SocialDao.assign_chat_folder(db_session, folder.id, chat.id, member.id)
    await SocialDao.assign_chat_folder(db_session, folder.id, chat.id, member.id)
    folders = await SocialDao.list_chat_folders(db_session, member.id)
    assert [(row.id, chat_ids) for row, chat_ids in folders] == [
        (folder.id, [chat.id]),
    ]
    await SocialDao.clear_chat_folder(db_session, chat.id, member.id)
    assert (await SocialDao.list_chat_folders(db_session, member.id))[0][1] == []

    await SocialDao.add_default_groups(db_session, db_user.id)
    categories = await SocialDao.list_friend_categories(db_session, db_user.id)
    assert {category.name for category in categories} == {
        "Коллеги",
        "Родители",
        "Знакомые",
    }
    default_folders = await SocialDao.list_chat_folders(db_session, db_user.id)
    assert {folder.name for folder, _ in default_folders} == {
        "Работа",
        "Друзья",
        "Семья",
    }

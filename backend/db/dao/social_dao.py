import uuid

from sqlalchemy import delete, insert, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.exceptions import DuplicateResourceError
from db.models import (
    chat_folder_chats,
    ChatFolder,
    FriendCategory,
    Friendship,
    friendship_categories,
    User,
)
from db.models.user import user_chat


class SocialDao:
    @staticmethod
    async def get_user(session: AsyncSession, user_id: uuid.UUID) -> User | None:
        return await session.get(User, user_id)

    @staticmethod
    async def list_friend_categories(
        session: AsyncSession,
        owner_id: uuid.UUID,
    ) -> list[FriendCategory]:
        result = await session.scalars(
            select(FriendCategory)
            .where(FriendCategory.owner_id == owner_id)
            .order_by(FriendCategory.is_default.desc(), FriendCategory.name),
        )
        return list(result.all())

    @staticmethod
    async def list_friendships(
        session: AsyncSession,
        user_id: uuid.UUID,
        *,
        status: str,
        requested_by_id: uuid.UUID | None = None,
        incoming_only: bool = False,
    ) -> list[Friendship]:
        query = select(Friendship).where(
            Friendship.status == status,
            or_(
                Friendship.user_low_id == user_id,
                Friendship.user_high_id == user_id,
            ),
        )
        if requested_by_id is not None:
            query = query.where(Friendship.requested_by_id == requested_by_id)
        if incoming_only:
            query = query.where(Friendship.requested_by_id != user_id)
        result = await session.scalars(query.order_by(Friendship.created_at.desc()))
        return list(result.all())

    @staticmethod
    async def get_other_friend(
        session: AsyncSession,
        friendship: Friendship,
        current_user_id: uuid.UUID,
    ) -> User | None:
        friend_id = (
            friendship.user_high_id
            if friendship.user_low_id == current_user_id
            else friendship.user_low_id
        )
        return await session.get(User, friend_id)

    @staticmethod
    async def get_friend_category_id(
        session: AsyncSession,
        friendship_id: uuid.UUID,
        owner_id: uuid.UUID,
    ) -> uuid.UUID | None:
        return await session.scalar(
            select(friendship_categories.c.category_id).where(
                friendship_categories.c.friendship_id == friendship_id,
                friendship_categories.c.owner_id == owner_id,
            ),
        )

    @staticmethod
    async def add_friend_category(
        session: AsyncSession,
        *,
        owner_id: uuid.UUID,
        name: str,
        color: str | None,
    ) -> FriendCategory:
        category = FriendCategory(owner_id=owner_id, name=name, color=color)
        session.add(category)
        try:
            await session.flush()
        except IntegrityError as error:
            raise DuplicateResourceError("Friend category already exists") from error
        return category

    @staticmethod
    async def get_friendship(
        session: AsyncSession,
        user_low_id: uuid.UUID,
        user_high_id: uuid.UUID,
        *,
        status: str | None = None,
        incoming_to_id: uuid.UUID | None = None,
    ) -> Friendship | None:
        query = select(Friendship).where(
            Friendship.user_low_id == user_low_id,
            Friendship.user_high_id == user_high_id,
        )
        if status is not None:
            query = query.where(Friendship.status == status)
        if incoming_to_id is not None:
            query = query.where(Friendship.requested_by_id != incoming_to_id)
        return await session.scalar(query)

    @staticmethod
    async def update_friendship(
        session: AsyncSession,
        friendship_id: uuid.UUID,
        *,
        status: str | None = None,
        requested_by_id: uuid.UUID | None = None,
    ) -> Friendship | None:
        friendship = await session.get(Friendship, friendship_id)
        if friendship is None:
            return None
        if status is not None:
            friendship.status = status
        if requested_by_id is not None:
            friendship.requested_by_id = requested_by_id
        await session.flush()
        return friendship

    @staticmethod
    async def delete_friendship(session: AsyncSession, friendship_id: uuid.UUID) -> None:
        await session.execute(delete(Friendship).where(Friendship.id == friendship_id))
        await session.flush()

    @staticmethod
    async def add_friendship(
        session: AsyncSession,
        *,
        user_low_id: uuid.UUID,
        user_high_id: uuid.UUID,
        requested_by_id: uuid.UUID,
    ) -> Friendship:
        friendship = Friendship(
            user_low_id=user_low_id,
            user_high_id=user_high_id,
            requested_by_id=requested_by_id,
            status="pending",
        )
        session.add(friendship)
        await session.flush()
        return friendship

    @staticmethod
    async def set_friend_category(
        session: AsyncSession,
        friendship_id: uuid.UUID,
        owner_id: uuid.UUID,
        category_id: uuid.UUID | None,
    ) -> bool:
        if category_id is not None:
            owned_category = await session.scalar(
                select(FriendCategory.id).where(
                    FriendCategory.id == category_id,
                    FriendCategory.owner_id == owner_id,
                ),
            )
            if owned_category is None:
                return False
        await session.execute(
            delete(friendship_categories).where(
                friendship_categories.c.friendship_id == friendship_id,
                friendship_categories.c.owner_id == owner_id,
            ),
        )
        if category_id is None:
            return True
        await session.execute(
            insert(friendship_categories).values(
                friendship_id=friendship_id,
                owner_id=owner_id,
                category_id=owned_category,
            ),
        )
        return True

    @staticmethod
    async def list_chat_folders(
        session: AsyncSession,
        owner_id: uuid.UUID,
    ) -> list[tuple[ChatFolder, list[uuid.UUID]]]:
        folders = await session.scalars(
            select(ChatFolder)
            .where(ChatFolder.owner_id == owner_id)
            .order_by(ChatFolder.is_default.desc(), ChatFolder.name),
        )
        result = []
        for folder in folders.all():
            chat_ids = await session.scalars(
                select(chat_folder_chats.c.chat_id).where(
                    chat_folder_chats.c.folder_id == folder.id,
                    chat_folder_chats.c.owner_id == owner_id,
                ),
            )
            result.append((folder, list(chat_ids.all())))
        return result

    @staticmethod
    async def add_chat_folder(
        session: AsyncSession,
        *,
        owner_id: uuid.UUID,
        name: str,
        color: str | None,
    ) -> ChatFolder:
        folder = ChatFolder(owner_id=owner_id, name=name, color=color)
        session.add(folder)
        try:
            await session.flush()
        except IntegrityError as error:
            raise DuplicateResourceError("Chat folder already exists") from error
        return folder

    @staticmethod
    async def is_chat_member(
        session: AsyncSession,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> bool:
        result = await session.scalar(
            select(user_chat.c.chat_id).where(
                user_chat.c.chat_id == chat_id,
                user_chat.c.user_id == user_id,
            ),
        )
        return result is not None

    @staticmethod
    async def clear_chat_folder(
        session: AsyncSession,
        chat_id: uuid.UUID,
        owner_id: uuid.UUID,
    ) -> None:
        await session.execute(
            delete(chat_folder_chats).where(
                chat_folder_chats.c.chat_id == chat_id,
                chat_folder_chats.c.owner_id == owner_id,
            ),
        )

    @staticmethod
    async def get_owned_chat_folder(
        session: AsyncSession,
        folder_id: uuid.UUID,
        owner_id: uuid.UUID,
    ) -> ChatFolder | None:
        return await session.scalar(
            select(ChatFolder).where(
                ChatFolder.id == folder_id,
                ChatFolder.owner_id == owner_id,
            ),
        )

    @staticmethod
    async def assign_chat_folder(
        session: AsyncSession,
        folder_id: uuid.UUID,
        chat_id: uuid.UUID,
        owner_id: uuid.UUID,
    ) -> None:
        await session.execute(
            pg_insert(chat_folder_chats)
            .values(folder_id=folder_id, chat_id=chat_id, owner_id=owner_id)
            .on_conflict_do_nothing(index_elements=["folder_id", "chat_id"]),
        )

    @staticmethod
    async def add_default_groups(session: AsyncSession, owner_id: uuid.UUID) -> None:
        session.add_all(
            [
                FriendCategory(owner_id=owner_id, name=name, is_default=True)
                for name in ("Коллеги", "Родители", "Знакомые")
            ]
            + [
                ChatFolder(owner_id=owner_id, name=name, is_default=True)
                for name in ("Работа", "Друзья", "Семья")
            ],
        )
        await session.flush()

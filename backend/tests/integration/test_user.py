from db.dao.user_dao import UserDao
from db.models.user import User


async def test_create_user(db_session):
    test_user = {"username": "chel", "password": "12345678", "email": "re@mail.ru"}
    user = await UserDao.add(session=db_session, data=test_user)
    assert test_user.get("username") == user.username
    assert test_user.get("email") == user.email
    assert test_user.get("password") == user.password


async def test_get_user(db_session, db_user: User):
    user_get = await UserDao.get_by_id(db_session, db_user.id)
    assert user_get.username == db_user.username
    assert user_get.email == db_user.email


async def test_update_user(db_session, db_user: User):
    print(db_user.to_dict())
    user_get = await UserDao.update(db_session, db_user.to_dict())
    assert user_get > 0

from db.dao.user_dao import UserDao


async def test_create_user(db_session):
    test_user = {"username": "chel", "password": "12345678", "email": "re@mail.ru"}
    await UserDao.add(session=db_session, data=test_user)

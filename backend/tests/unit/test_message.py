# import uuid

# from fastapi import status, UploadFile
# from starlette.datastructures import Headers
# from httpx import AsyncClient
# from core.storage import S3Storage
# from db.dao.attachment_dao import AttachmentDao
# from sqlalchemy.ext.asyncio import AsyncSession
# async def test_get_chat_history(
#     spam_history: uuid.UUID,
#     api_client: AsyncClient,
#     auth_token_and_user,
# ):
#     headers = {"Authorization": f"Bearer {auth_token_and_user}"}
#     res = await api_client.get(
#         url=f"/api/v1/chats/{spam_history}/messages",
#         headers=headers,
#     )
#     assert res.status_code == status.HTTP_200_OK


# async def test_send_image(
#     chat_id: uuid.UUID,
#     id_first_user,
#     api_client: AsyncClient,
#     auth_token_and_user,
#     db_session: AsyncSession,
# ):
#     with open("backend/tests/files/testimage.jpg", "rb") as f:
#         custom_headers = Headers({
#             "content-type": "image/jpeg",
#             "content-length": str(10000)
#         })
#         upload_file = UploadFile(
#             filename="testimage.jpg",
#             file=f,
#             headers=custom_headers,
#             size=10000,
#         )
#         s3 = S3Storage()
#         url = await s3.upload_avatar(upload_file, id_first_user)
#         image = await AttachmentDao.add(session=db_session, data={
#             "user_id": id_first_user,
#             "attachment_url": url,
#             "mime_type": upload_file.content_type,
#             "file_name": upload_file.filename,
#             "file_size": upload_file.size,
#         })
#         await db_session.flush()
#     headers = {"Authorization": f"Bearer {auth_token_and_user}"}
#     res = await api_client.post(
#         url=f"/api/v1/chats/{chat_id}/messages",
#         headers=headers,
#         json={
# "text": "look",
#  "attachments": [{"id": str(image.id),
#  "url": image.attachment_url}]},
#     )
#     assert res.status_code == status.HTTP_201_CREATED

#     res = await api_client.get(f"/api/v1/chats/{chat_id}/messages", headers=headers)
#     print(res.json())
#     assert res.status_code == status.HTTP_200_OK

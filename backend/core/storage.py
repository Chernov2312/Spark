import datetime
import uuid

import aioboto3
from fastapi import UploadFile

from config import yandex_storage


class S3Storage:
    def __init__(self):
        self.session = aioboto3.Session()
        self.config = {
            "aws_access_key_id": yandex_storage.YANDEX_CLOUD_KEY_ID,
            "aws_secret_access_key": yandex_storage.YANDEX_CLOUD_KEY,
            "endpoint_url": yandex_storage.ENDPOINT_URL,
        }
        self.bucket_name = yandex_storage.BUCKET_NAME

    async def upload_file(
        self,
        file: UploadFile,
        target_id: uuid.UUID,
        category: str,
    ) -> str:
        file_extension = file.content_type.split("/")[-1]
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        file_key = f"{category}/{target_id}/{timestamp}.{file_extension}"

        async with self.session.client("s3", **self.config) as s3:
            file_content = await file.read()
            await s3.put_object(
                Bucket=self.bucket_name,
                Key=file_key,
                Body=file_content,
                ContentType=file.content_type,
            )

        return file_key

    async def get_temporary_url(self, file_key: str, expires_in: int = 3600) -> str:
        async with self.session.client("s3", **self.config) as s3:
            url = await s3.generate_presigned_url(
                ClientMethod="get_object",
                Params={
                    "Bucket": self.bucket_name,
                    "Key": file_key,
                },
                ExpiresIn=expires_in,
            )
            return url

    async def delete_avatar(self, file_url: str) -> bool:
        splitted = file_url.split("/")
        file_key = "/".join(splitted[-3:])
        try:
            async with self.session.client("s3", **self.config) as s3:
                await s3.delete_object(
                    Bucket=self.bucket_name,
                    Key=file_key,
                )
                return True
        except Exception:
            return False

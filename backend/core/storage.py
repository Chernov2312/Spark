import datetime
import os
import uuid

import aioboto3
import aiofiles
from fastapi import UploadFile
from botocore.client import Config
from config import yandex_storage


class S3Storage:
    def __init__(self):
        self.session = aioboto3.Session()
        s3_config = Config(
            signature_version="s3v4",
            region_name="ru-central1",
        )
        self.config = {
            "aws_access_key_id": yandex_storage.YANDEX_CLOUD_KEY_ID,
            "aws_secret_access_key": yandex_storage.YANDEX_CLOUD_KEY,
            "endpoint_url": yandex_storage.ENDPOINT_URL,
            "config": s3_config,
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
            await s3.put_object(
                Bucket=self.bucket_name,
                Key=file_key,
                Body=file.file,
                ContentType=file.content_type,
            )

        return file_key

    async def load_file(
        self,
        file_key: str,
        destination_path: str,
    ) -> None:
        async with self.session.client("s3", **self.config) as s3:
            response = await s3.get_object(Bucket=self.bucket_name, Key=file_key)

            os.makedirs(os.path.dirname(destination_path), exist_ok=True)

            async with aiofiles.open(destination_path, "wb") as local_file:
                async for chunk in response["Body"].iter_chunks(chunk_size=65536):
                    await local_file.write(chunk)

    async def get_temporary_url(
        self,
        file_key: str,
        client_method: str = "get_object",
        expires_in: int = 3600,
    ) -> str | None:
        if file_key is None:
            return None
        async with self.session.client("s3", **self.config) as s3:
            url = await s3.generate_presigned_url(
                ClientMethod=client_method,
                Params={
                    "Bucket": self.bucket_name,
                    "Key": file_key,
                },
                ExpiresIn=expires_in,
            )
            return url

    def get_file_key(self, url: str) -> str:
        return "/".join(url.split("?")[0].split("/")[-3:])

    def create_file_key(self, file_extension, target_id, category):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        return f"{category}/{target_id}/{timestamp}.{file_extension}"
    async def delete_file_by_key(self, file_key: str) -> bool:
        try:
            async with self.session.client("s3", **self.config) as s3:
                await s3.delete_object(
                    Bucket=self.bucket_name,
                    Key=file_key,
                )
                return True
        except Exception:
            return False

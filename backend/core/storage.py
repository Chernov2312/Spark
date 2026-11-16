import asyncio
from pathlib import Path
import uuid

import aioboto3
import aiofiles
from botocore.client import Config
from fastapi import UploadFile

from config import get_storage_settings


class S3Storage:
    def __init__(self) -> None:
        yandex_storage = get_storage_settings()
        self.session = aioboto3.Session()
        s3_config = Config(
            signature_version="s3v4",
            region_name="ru-central1",
            s3={"addressing_style": "path"},
        )
        self.config = {
            "aws_access_key_id": yandex_storage.YANDEX_CLOUD_KEY_ID,
            "aws_secret_access_key": yandex_storage.YANDEX_CLOUD_KEY.get_secret_value(),
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
        file_content_type = file.content_type or "application/octet-stream"
        file_extension = file_content_type.split("/")[-1]
        file_key = self.create_file_key(file_extension, target_id, category)
        contents = await file.read()

        async with self.session.client("s3", **self.config) as s3:
            await s3.put_object(
                Bucket=self.bucket_name,
                Key=file_key,
                Body=contents,
                ContentType=file_content_type,
            )

        return file_key

    async def load_file(
        self,
        file_key: str,
        destination_path: str,
    ) -> None:
        async with self.session.client("s3", **self.config) as s3:
            response = await s3.get_object(Bucket=self.bucket_name, Key=file_key)

            await asyncio.to_thread(
                Path(destination_path).parent.mkdir,
                parents=True,
                exist_ok=True,
            )

            async with aiofiles.open(destination_path, "wb") as local_file:
                async for chunk in response["Body"].iter_chunks(chunk_size=65536):
                    await local_file.write(chunk)

    async def get_temporary_url(
        self,
        file_key: str | None,
        client_method: str = "get_object",
        expires_in: int = 3600,
        response_content_disposition: str | None = None,
    ) -> str | None:
        if file_key is None:
            return None
        async with self.session.client("s3", **self.config) as s3:
            params = {
                "Bucket": self.bucket_name,
                "Key": file_key,
            }
            if response_content_disposition:
                params["ResponseContentDisposition"] = response_content_disposition
            url = await s3.generate_presigned_url(
                ClientMethod=client_method,
                Params=params,
                ExpiresIn=expires_in,
            )
            return url

    def get_file_key(self, url: str) -> str:
        return "/".join(url.split("?")[0].split("/")[-3:])

    def create_file_key(
        self,
        file_extension: str,
        target_id: uuid.UUID,
        category: str,
    ) -> str:
        unique_name = uuid.uuid4().hex
        return f"{category}/{target_id}/{unique_name}.{file_extension}"

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

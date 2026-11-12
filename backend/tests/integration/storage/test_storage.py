import asyncio
from io import BytesIO
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen
from uuid import uuid4

from starlette.datastructures import Headers, UploadFile

from core.storage import S3Storage


def fetch_url(url: str) -> tuple[int, bytes]:
    with urlopen(url, timeout=10) as response:
        return response.status, response.read()


async def test_s3_upload_returns_working_presigned_url(minio_s3_storage):
    payload = b"Spark integration attachment"
    upload = UploadFile(
        filename="note.txt",
        file=BytesIO(payload),
        headers=Headers({"content-type": "text/plain"}),
    )
    storage = S3Storage()
    file_key = await storage.upload_file(
        upload,
        target_id=uuid4(),
        category="user_message",
    )

    url = await storage.get_temporary_url(file_key)

    assert url is not None
    parsed_url = urlsplit(url)
    query = parse_qs(parsed_url.query)
    assert parsed_url.scheme == "http"
    assert parsed_url.netloc == urlsplit(minio_s3_storage["endpoint"]).netloc
    assert parsed_url.path == f"/{minio_s3_storage['bucket_name']}/{file_key}"
    assert query["X-Amz-Signature"]
    assert query["X-Amz-Credential"]

    status_code, downloaded = await asyncio.to_thread(fetch_url, url)

    assert status_code == 200
    assert downloaded == payload

import uuid

from pydantic import BaseModel, ConfigDict


class AttachmentResponse(BaseModel):
    id: uuid.UUID
    url: str
    user_id: uuid.UUID
    file_name: str
    file_size: int
    mime_type: str

    model_config = ConfigDict(from_attributes=True)

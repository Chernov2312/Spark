import uuid

from pydantic import BaseModel, ConfigDict, Field


class AttachmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attachment_url: str
    file_name: str
    file_size: int = Field(ge=0)
    mime_type: str
    text: str | None = None


class AttachmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    attachment_url: str
    file_name: str
    file_size: int
    mime_type: str
    text: str | None = None
    user_id: uuid.UUID

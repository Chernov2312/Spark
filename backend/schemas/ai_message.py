import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class SummarizeResponce(BaseModel):
    chat_id: uuid.UUID
    summary: str
    generated_at: datetime


class RewriteRequest(BaseModel):
    text: str
    mode: Literal["professional", "friendly", "fix_grammar", "make_longer"] = (
        "professional"
    )


class RewriteResponse(BaseModel):
    original_text: str
    modified_text: str

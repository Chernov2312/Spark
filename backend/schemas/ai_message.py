from datetime import datetime
from typing import Literal
import uuid

from pydantic import BaseModel, Field


class SummarizeResponce(BaseModel):
    chat_id: uuid.UUID
    summary: str
    generated_at: datetime


class ChatAssistantRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=30, ge=1, le=100)


class ChatAssistantResponse(BaseModel):
    answer: str
    context_messages: int


class SystemAssistantRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class SystemAssistantResponse(BaseModel):
    answer: str


class RewriteRequest(BaseModel):
    text: str
    mode: Literal["professional", "friendly", "fix_grammar", "make_longer"] = (
        "professional"
    )


class RewriteResponse(BaseModel):
    original_text: str
    modified_text: str

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ReactionsPostResponse(BaseModel):
    emoji: str = Field(..., max_length=1)

from pydantic import BaseModel, Field


class UserRegister(BaseModel):
    username: str = Field(..., nullable=False, max_length=10)


class Vernul(BaseModel):
    status: str

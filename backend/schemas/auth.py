import uuid

from pydantic import BaseModel, Field


class UserRegister(BaseModel):
    name: str = Field(..., nullable=False, max_length=50)
    email: str = Field(..., nullable=False, max_length=50)
    password: str = Field(..., nullable=False, max_length=50)


class UserLogin(BaseModel):
    email: str = Field(..., nullable=False, max_length=50)
    password: str = Field(..., nullable=False, max_length=50)


class UserResponse(BaseModel):
    id: uuid.UUID = Field(..., nullable=False)
    username: str = Field(..., nullable=False, max_length=50)

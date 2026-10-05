import uuid

from pydantic import BaseModel, Field


class UserRegister(BaseModel):
    username: str = Field(..., nullable=False, max_length=50)
    email: str = Field(..., nullable=False, max_length=50)
    password: str = Field(..., nullable=False, max_length=250)


class UserLogin(BaseModel):
    username: str = Field(..., nullable=False, max_length=50)
    password: str = Field(..., nullable=False, max_length=250)


class UserResponse(BaseModel):
    id: uuid.UUID = Field(..., nullable=False)
    username: str = Field(..., nullable=False, max_length=50)
    email: str = Field(..., nullable=False, max_length=50)
    access_token: str = Field(..., nullable=False, max_length=250)
    token_type: str = "bearer"

import uuid

from pydantic import BaseModel, Field


class UserRegister(BaseModel):
    username: str = Field(..., nullable=False, max_length=50)
    email: str = Field(..., nullable=False, max_length=50)
    password: str = Field(..., nullable=False, max_length=250)


class UserLogin(BaseModel):
    email: str = Field(..., nullable=False, max_length=50)
    password: str = Field(..., nullable=False, max_length=250)


class UserRegisterResponse(BaseModel):
    id: uuid.UUID = Field(..., nullable=False)
    username: str = Field(..., nullable=False, max_length=50)


class UserLoginResponse(BaseModel):
    id: uuid.UUID = Field(..., nullable=False)
    username: str = Field(..., nullable=False, max_length=50)
    email: str = Field(..., nullable=False, max_length=50)
    token: str = Field(..., nullable=False, max_length=250)

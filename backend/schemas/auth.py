import re
import uuid

from pydantic import BaseModel, EmailStr, Field, model_validator

password_valid = re.compile(
    r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$",
)


class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    tag: str | None = Field(default=None, max_length=32)
    email: EmailStr = Field(..., max_length=100)
    password: str = Field(..., min_length=8, max_length=250)

    @model_validator(mode="after")
    def check_password(self):
        if not password_valid.match(self.password):
            raise ValueError("Password must contain Upper, Lower word and digits")
        return self


class UserLogin(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8, max_length=250)


class UserRegistrationResponse(BaseModel):
    id: uuid.UUID
    username: str = Field(..., min_length=3, max_length=50)
    tag: str = Field(..., min_length=3, max_length=32)
    email: EmailStr
    verification_required: bool = True


class UserResponse(BaseModel):
    id: uuid.UUID = Field(...)
    username: str = Field(..., min_length=3, max_length=50)
    tag: str = Field(..., min_length=3, max_length=32)
    email: EmailStr = Field(..., max_length=100)
    access_token: str = Field(..., max_length=250)
    token_type: str = "bearer"

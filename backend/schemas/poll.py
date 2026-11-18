from typing import Annotated
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator, StringConstraints

PollOptionText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)
]


class PollCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    question: str = Field(min_length=1, max_length=300)
    options: list[PollOptionText] = Field(min_length=2, max_length=10)
    is_anonymous: bool = True
    allow_retract: bool = True
    is_quiz: bool = False
    correct_option_index: int | None = Field(default=None, ge=0, le=9)
    thread_root_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def validate_options(self) -> "PollCreate":
        if len({option.casefold() for option in self.options}) != len(self.options):
            raise ValueError("Poll options must be unique")
        if self.is_quiz:
            if self.correct_option_index is None or self.correct_option_index >= len(
                self.options
            ):
                raise ValueError("Choose a correct answer for the quiz")
        elif self.correct_option_index is not None:
            raise ValueError("Only quizzes can have a correct answer")
        return self


class PollVoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    option_id: uuid.UUID


class PollVoter(BaseModel):
    id: uuid.UUID
    username: str
    tag: str


class PollOptionResponse(BaseModel):
    id: uuid.UUID
    text: str
    votes_count: int
    voters: list[PollVoter] | None = None


class PollResponse(BaseModel):
    id: uuid.UUID
    message_id: uuid.UUID
    chat_id: uuid.UUID
    question: str
    is_anonymous: bool
    allow_retract: bool
    is_quiz: bool
    is_creator: bool
    options: list[PollOptionResponse]
    total_votes: int
    my_option_id: uuid.UUID | None
    correct_option_id: uuid.UUID | None
    version: int

from base64 import b64decode
from typing import Self
from urllib.parse import urlsplit
import uuid

from cryptography.hazmat.primitives.asymmetric import ec
from pydantic import BaseModel, Field, field_validator, model_validator


def validate_push_endpoint(endpoint: str) -> str:
    if not endpoint.isascii() or any(
        char <= " " or char in "\\\x7f" for char in endpoint
    ):
        raise ValueError("Invalid push endpoint")
    url = urlsplit(endpoint)
    host = url.hostname or ""
    supported = (
        (host == "fcm.googleapis.com" and url.path.startswith(("/fcm/send/", "/wp/")))
        or host == "updates.push.services.mozilla.com"
        or host.endswith(".push.apple.com")
    )
    if (
        url.scheme != "https"
        or not supported
        or url.username is not None
        or url.port not in (None, 443)
        or url.path in ("", "/")
        or url.fragment
    ):
        raise ValueError("Unsupported push endpoint")
    return endpoint


class PushConfigResponse(BaseModel):
    public_key: str | None


class PushEndpoint(BaseModel):
    endpoint: str = Field(max_length=2048)

    @field_validator("endpoint")
    @classmethod
    def check_endpoint(cls, value: str) -> str:
        return validate_push_endpoint(value)


def decode_push_key(value: str) -> bytes:
    try:
        return b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except ValueError as error:
        raise ValueError("Invalid push key encoding") from error


class PushKeys(BaseModel):
    p256dh: str = Field(max_length=90)
    auth: str = Field(max_length=24)

    @model_validator(mode="after")
    def check_keys(self) -> Self:
        key = decode_push_key(self.p256dh)
        if len(key) != 65 or key[0] != 4 or len(decode_push_key(self.auth)) != 16:
            raise ValueError("Invalid push subscription keys")
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), key)
        return self


class PushChatOptions(BaseModel):
    muted: bool = False
    silent: bool = False


class PushSubscriptionRequest(PushEndpoint):
    keys: PushKeys
    chat_options: dict[uuid.UUID, PushChatOptions] = Field(default_factory=dict)

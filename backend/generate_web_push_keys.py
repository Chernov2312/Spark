from base64 import urlsafe_b64encode

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


def encode(value: bytes) -> str:
    return urlsafe_b64encode(value).decode("ascii").rstrip("=")


def main() -> None:
    private_key = ec.generate_private_key(ec.SECP256R1())
    private = private_key.private_numbers().private_value.to_bytes(32, "big")
    public = private_key.public_key().public_bytes(
        Encoding.X962, PublicFormat.UncompressedPoint
    )
    print(f"WEB_PUSH_PUBLIC_KEY={encode(public)}")
    print(f"WEB_PUSH_PRIVATE_KEY={encode(private)}")


if __name__ == "__main__":
    main()

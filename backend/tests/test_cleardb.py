from cleardb import database_address
import pytest


@pytest.mark.parametrize(
    ("host", "port", "in_docker", "expected"),
    [
        ("postgres", 5432, False, ("127.0.0.1", 5433)),
        ("postgres", 5432, True, ("postgres", 5432)),
        ("localhost", 5434, False, ("localhost", 5434)),
        ("db.example.com", 5432, False, ("db.example.com", 5432)),
    ],
)
def test_database_address(
    host: str, port: int, in_docker: bool, expected: tuple[str, int]
) -> None:
    assert database_address(host, port, in_docker=in_docker) == expected

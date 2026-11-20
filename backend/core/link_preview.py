import asyncio
from contextlib import aclosing
from html.parser import HTMLParser
import ipaddress
import re
import socket

import httpx

from schemas.message import LinkPreview

MAX_URL_LENGTH = 2048
MAX_HTML_BYTES = 128 * 1024
REDIRECT_CODES = {301, 302, 303, 307, 308}


def parse_preview_url(value: str) -> httpx.URL:
    if len(value) > MAX_URL_LENGTH or re.search(r"[\x00-\x20\x7f\\]", value):
        raise ValueError("Invalid preview URL")
    try:
        url = httpx.URL(value)
    except httpx.InvalidURL as error:
        raise ValueError("Invalid preview URL") from error
    default_port = {"https": 443, "http": 80}.get(url.scheme)
    if (
        default_port is None
        or not url.host
        or url.userinfo
        or url.port not in (None, default_port)
        or "%" in url.host
    ):
        raise ValueError("Unsupported preview URL")
    return url.copy_with(fragment=None)


async def _resolve_public_addresses(
    host: str,
    port: int,
) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    entries = await asyncio.get_running_loop().getaddrinfo(
        host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP
    )
    addresses = list(
        dict.fromkeys(ipaddress.ip_address(entry[4][0]) for entry in entries)
    )
    for address in addresses:
        if not address.is_global or address.is_multicast or address.is_reserved:
            raise ValueError("Preview address is not public")
        if isinstance(address, ipaddress.IPv6Address) and (
            address not in ipaddress.IPv6Network("2000::/3")
            or address.sixtofour is not None
            or address.teredo is not None
        ):
            raise ValueError("Unsupported IPv6 preview address")
    return addresses


class PageMetadata(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, str] = {}
        self.title: list[str] = []
        self.in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self.in_title = True
        if tag == "meta":
            attributes = dict(attrs)
            name = (attributes.get("property") or attributes.get("name") or "").lower()
            content = " ".join((attributes.get("content") or "").split())
            if name in {"og:title", "og:description", "description"} and content:
                self.meta.setdefault(name, content)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title.append(data)

    def preview(self, source_url: str) -> LinkPreview | None:
        title = self.meta.get("og:title") or " ".join("".join(self.title).split())
        if not title:
            return None
        description = self.meta.get("og:description") or self.meta.get("description")
        return LinkPreview(
            url=source_url,
            title=title[:160],
            description=description[:320] if description else None,
        )


async def fetch_link_preview(source_url: str) -> LinkPreview | None:
    try:
        current = parse_preview_url(source_url)
        async with asyncio.timeout(6):
            for _ in range(4):
                host = current.raw_host.decode("ascii")
                port = current.port or (443 if current.scheme == "https" else 80)
                addresses = await _resolve_public_addresses(host, port)
                if not addresses:
                    return None
                ip = next(
                    (address for address in addresses if address.version == 4),
                    addresses[0],
                )
                # Connect to the validated address while verifying TLS for the original host.
                async with httpx.AsyncHTTPTransport(trust_env=False) as transport:
                    request = httpx.Request(
                        "GET",
                        current.copy_with(host=str(ip)),
                        headers={
                            "Host": current.netloc.decode("ascii"),
                            "Accept": "text/html, application/xhtml+xml",
                            "Accept-Encoding": "identity",
                            "User-Agent": "Spark-Link-Preview/1.0",
                        },
                        extensions={
                            "sni_hostname": host,
                            "timeout": httpx.Timeout(3).as_dict(),
                        },
                    )
                    # The transport does not log the URL and its query parameters.
                    async with aclosing(
                        await transport.handle_async_request(request)
                    ) as response:
                        if response.status_code in REDIRECT_CODES:
                            location = response.headers.get("location")
                            if not location:
                                return None
                            current = parse_preview_url(str(current.join(location)))
                            continue
                        content_type = (
                            response.headers.get("content-type", "")
                            .split(";")[0]
                            .strip()
                            .lower()
                        )
                        encoding = (
                            response.headers.get("content-encoding", "identity")
                            .strip()
                            .lower()
                        )
                        if (
                            response.status_code != 200
                            or content_type not in {"text/html", "application/xhtml+xml"}
                            or encoding != "identity"
                        ):
                            return None
                        body = bytearray()
                        async for chunk in response.aiter_raw():
                            body.extend(chunk[: MAX_HTML_BYTES - len(body)])
                            if len(body) == MAX_HTML_BYTES:
                                break
                        parser = PageMetadata()
                        parser.feed(
                            body.decode(response.encoding or "utf-8", errors="replace")
                        )
                        parser.close()
                        return parser.preview(source_url)
    except (ValueError, OSError, LookupError, httpx.HTTPError, httpx.InvalidURL):
        return None
    return None

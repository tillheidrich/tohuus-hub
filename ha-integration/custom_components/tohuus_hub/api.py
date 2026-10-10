"""Small async client for the ToHuus Hub Home Assistant API (/api/ha/v1)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
import json
import logging
from typing import Any

from aiohttp import ClientError, ClientResponse, ClientSession, ClientTimeout

_LOGGER = logging.getLogger(__name__)

API_PREFIX = "/api/ha/v1"
REQUEST_TIMEOUT = ClientTimeout(total=20)


class ToHuusError(Exception):
    """Base error."""


class ToHuusConnectionError(ToHuusError):
    """ToHuus Hub could not be reached."""


class ToHuusAuthError(ToHuusError):
    """The token was rejected (401/403)."""


class ToHuusNotSupportedError(ToHuusError):
    """The server does not offer the v1 integration API (too old)."""


class ToHuusRequestError(ToHuusError):
    """The server refused a request (4xx), message is user-facing."""


def normalize_url(url: str) -> str:
    """Strip spaces and trailing slashes; add http:// if no scheme was given."""
    url = url.strip().rstrip("/")
    if not url.startswith(("http://", "https://")):
        url = f"http://{url}"
    return url


class ToHuusApi:
    """Talks to one ToHuus Hub instance with a Bearer token (scope "Home Assistant")."""

    def __init__(self, session: ClientSession, url: str, token: str) -> None:
        self._session = session
        self.url = normalize_url(url)
        self._token = token

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}", "Accept": "application/json"}

    async def _raise_for(self, resp: ClientResponse) -> None:
        if resp.status < 400:
            return
        try:
            body = await resp.json(content_type=None)
            message = body.get("error") if isinstance(body, dict) else None
        except (ValueError, ClientError):
            message = None
        if resp.status in (401, 403):
            raise ToHuusAuthError(message or f"HTTP {resp.status}")
        if resp.status == 404 and message == "not found":
            raise ToHuusNotSupportedError(message)
        if resp.status < 500:
            raise ToHuusRequestError(message or f"HTTP {resp.status}")
        raise ToHuusConnectionError(message or f"HTTP {resp.status}")

    async def request(self, method: str, path: str, *, json_body: Any = None, params: dict[str, Any] | None = None) -> Any:
        """Call the API and return the decoded JSON body."""
        try:
            async with self._session.request(
                method,
                f"{self.url}{API_PREFIX}{path}",
                headers=self._headers,
                json=json_body,
                params=params,
                timeout=REQUEST_TIMEOUT,
            ) as resp:
                await self._raise_for(resp)
                return await resp.json(content_type=None)
        except (TimeoutError, ClientError) as err:
            raise ToHuusConnectionError(str(err) or err.__class__.__name__) from err

    async def get_bytes(self, path: str, params: dict[str, Any] | None = None) -> bytes:
        """Fetch binary content (display PNG)."""
        try:
            async with self._session.get(f"{self.url}{API_PREFIX}{path}", headers=self._headers, params=params, timeout=REQUEST_TIMEOUT) as resp:
                await self._raise_for(resp)
                return await resp.read()
        except (TimeoutError, ClientError) as err:
            raise ToHuusConnectionError(str(err) or err.__class__.__name__) from err

    # ------------------------------------------------------------- reads

    async def info(self) -> dict[str, Any]:
        """Instance info; used to validate URL and token."""
        data = await self.request("GET", "/info")
        if not isinstance(data, dict) or "instance_id" not in data:
            raise ToHuusNotSupportedError("unexpected response")
        return data

    async def state(self) -> dict[str, Any]:
        """Everything the entities need, in one call."""
        return await self.request("GET", "/state")

    async def meal_events(self, start: str, end: str) -> list[dict[str, Any]]:
        """Meal plan entries between two ISO dates."""
        return (await self.request("GET", "/calendar/meals", params={"start": start, "end": end}))["events"]

    async def care_events(self, start: str, end: str) -> list[dict[str, Any]]:
        """Care tasks (recurrences projected) between two ISO dates."""
        return (await self.request("GET", "/calendar/care", params={"start": start, "end": end}))["events"]

    async def display_png(self, display_id: int, width: int, height: int, mode: str) -> bytes:
        """Kitchen display rendered as PNG."""
        return await self.get_bytes(f"/display/{display_id}/image.png", {"w": width, "h": height, "mode": mode})

    # ------------------------------------------------------------- to-do

    async def todo_create(self, summary: str, description: str | None = None) -> Any:
        """Add to the shopping list."""
        return await self.request("POST", "/todo", json_body={"summary": summary, "description": description})

    async def todo_update(self, uid: str, **fields: Any) -> Any:
        """Rename, tick off or edit the description."""
        return await self.request("PATCH", f"/todo/{uid}", json_body=fields)

    async def todo_delete(self, uids: list[str]) -> Any:
        """Remove items."""
        return await self.request("POST", "/todo/delete", json_body={"uids": uids})

    async def todo_move(self, uid: str, previous_uid: str | None) -> Any:
        """Drag and drop."""
        return await self.request("POST", f"/todo/{uid}/move", json_body={"previous_uid": previous_uid})

    # ------------------------------------------------------------- services

    async def service(self, name: str, data: dict[str, Any] | None = None) -> Any:
        """Call one of the /services/<name> endpoints."""
        body = {k: v for k, v in (data or {}).items() if v is not None}
        return await self.request("POST", f"/services/{name}", json_body=body)

    # ------------------------------------------------------------- live events

    async def events(self) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        """Yield (event, data) from the server-sent event stream until it closes."""
        try:
            async with self._session.get(
                f"{self.url}{API_PREFIX}/events",
                headers={**self._headers, "Accept": "text/event-stream"},
                # no total timeout: the stream stays open; the server pings every 25 s
                timeout=ClientTimeout(total=None, connect=15, sock_read=90),
            ) as resp:
                await self._raise_for(resp)
                event = "message"
                data: list[str] = []
                async for raw in resp.content:
                    line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                    if not line:
                        if data:
                            try:
                                payload = json.loads("\n".join(data))
                            except ValueError:
                                payload = {}
                            yield event, payload if isinstance(payload, dict) else {}
                        event, data = "message", []
                        continue
                    if line.startswith(":"):
                        continue
                    key, _, value = line.partition(":")
                    value = value.removeprefix(" ")
                    if key == "event":
                        event = value
                    elif key == "data":
                        data.append(value)
        except (TimeoutError, ClientError, asyncio.IncompleteReadError) as err:
            raise ToHuusConnectionError(str(err) or err.__class__.__name__) from err

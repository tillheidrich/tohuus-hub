"""Cookidoo week plan → ToHuus Hub.

The official Cookidoo integration exposes "My week" as a calendar entity. This module reads its events for the
next days through the `calendar.get_events` service and posts them to ToHuus Hub (/api/ha/v1/cookidoo), which
mirrors them into the meal plan. Runs every 3 hours and whenever the calendar entity changes – so ToHuus Hub
needs no Home Assistant token of its own.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
import hashlib
import json
import logging
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import CALLBACK_TYPE, Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval
from homeassistant.util import dt as dt_util

from .api import ToHuusApi, ToHuusError, ToHuusNotSupportedError
from .const import (
    CONF_COOKIDOO_ENTITY,
    CONF_COOKIDOO_SYNC,
    COOKIDOO_DAYS,
    COOKIDOO_INTERVAL,
    DEFAULT_COOKIDOO_ENTITY,
)

_LOGGER = logging.getLogger(__name__)


def cookidoo_entity(hass: HomeAssistant, options: dict[str, Any]) -> str | None:
    """The calendar to read: the option, else the Cookidoo default if it exists."""
    if not options.get(CONF_COOKIDOO_SYNC, True):
        return None
    configured = options.get(CONF_COOKIDOO_ENTITY)
    if configured:
        return str(configured)
    return DEFAULT_COOKIDOO_ENTITY if hass.states.get(DEFAULT_COOKIDOO_ENTITY) is not None else None


def events_payload(response: dict[str, Any], entity_id: str) -> list[dict[str, Any]]:
    """`calendar.get_events` response → [{date, summary, description}] for ToHuus Hub."""
    out: list[dict[str, Any]] = []
    for ev in (response.get(entity_id) or {}).get("events") or []:
        start = ev.get("start")
        if isinstance(start, datetime):
            day = dt_util.as_local(start).date().isoformat()
        else:
            day = str(start or "")[:10]
        summary = str(ev.get("summary") or "").strip()
        if not day or not summary:
            continue
        out.append({"date": day, "summary": summary, "description": ev.get("description")})
    return out


class CookidooPush:
    """Pushes the Cookidoo calendar of one HA instance to one ToHuus Hub."""

    def __init__(self, hass: HomeAssistant, api: ToHuusApi, entity_id: str) -> None:
        self.hass = hass
        self.api = api
        self.entity_id = entity_id
        self._last_hash: str | None = None
        self._unsupported = False
        self.last_result: dict[str, Any] | None = None
        self.last_error: str | None = None
        self._unsubs: list[CALLBACK_TYPE] = []

    @callback
    def start(self) -> Callable[[], None]:
        """Schedule the periodic push and the push on calendar changes; returns the unsubscribe callback."""
        self._unsubs.append(async_track_time_interval(self.hass, self._interval, COOKIDOO_INTERVAL, name="tohuus_hub cookidoo"))
        self._unsubs.append(async_track_state_change_event(self.hass, [self.entity_id], self._changed))
        self.hass.async_create_background_task(self.async_push(), "tohuus_hub cookidoo initial push")
        return self.stop

    @callback
    def stop(self) -> None:
        """Unsubscribe everything."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()

    async def _interval(self, _now: datetime) -> None:
        await self.async_push(force=True)

    @callback
    def _changed(self, event: Event[EventStateChangedData]) -> None:
        new = event.data["new_state"]
        if new is None or new.state == STATE_UNAVAILABLE:
            return
        self.hass.async_create_background_task(self.async_push(), "tohuus_hub cookidoo push")

    async def async_read_events(self, start: datetime, end: datetime) -> dict[str, Any]:
        """Events of the calendar entity via the `calendar.get_events` service."""
        return await self.hass.services.async_call(
            "calendar",
            "get_events",
            {"entity_id": self.entity_id, "start_date_time": start, "end_date_time": end},
            blocking=True,
            return_response=True,
        ) or {}

    async def async_push(self, force: bool = False) -> dict[str, Any] | None:
        """Read the next days from the calendar and send them. Skips unchanged data unless forced."""
        if self._unsupported:
            return None
        state = self.hass.states.get(self.entity_id)
        if state is None or state.state == STATE_UNAVAILABLE:
            return None
        now = dt_util.now()
        start = dt_util.start_of_local_day(now)
        end = start + timedelta(days=COOKIDOO_DAYS)
        try:
            response = await self.async_read_events(start, end)
        except (HomeAssistantError, ValueError) as err:
            self.last_error = str(err)
            _LOGGER.debug("Could not read %s: %s", self.entity_id, err)
            return None
        events = events_payload(response or {}, self.entity_id)
        body = {
            "entity_id": self.entity_id,
            "events": events,
            "start": start.date().isoformat(),
            "end": (end - timedelta(days=1)).date().isoformat(),
        }
        digest = hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()
        if not force and digest == self._last_hash:
            return self.last_result
        try:
            self.last_result = await self.api.cookidoo(body)
        except ToHuusNotSupportedError:
            _LOGGER.info("This ToHuus Hub does not accept the Cookidoo week yet – update ToHuus Hub")
            self._unsupported = True
            return None
        except ToHuusError as err:
            self.last_error = str(err)
            _LOGGER.warning("Sending the Cookidoo week to ToHuus Hub failed: %s", err)
            return None
        self._last_hash = digest
        self.last_error = None
        return self.last_result

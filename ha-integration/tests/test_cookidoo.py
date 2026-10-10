"""Cookidoo week → ToHuus Hub push."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from unittest.mock import patch

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from custom_components.tohuus_hub.const import CONF_COOKIDOO_SYNC, CONF_LIVE_UPDATES, DEFAULT_COOKIDOO_ENTITY
from custom_components.tohuus_hub.cookidoo import CookidooPush, events_payload

from .conftest import API

EVENTS: list[dict[str, Any]] = [
    {"start": "2026-10-12", "end": "2026-10-13", "summary": "Köttbullar mit Pilzsauce", "description": "Total Time: 4200.0"},
    {"start": "2026-10-13", "end": "2026-10-14", "summary": "Reistopf ", "description": "Total Time: 1800.0"},
]


class FakeCalendar:
    """Stands in for calendar.get_events (the real calendar component loads with our calendar platform)."""

    def __init__(self, events: list[dict[str, Any]]) -> None:
        self.events = events
        self.calls: list[tuple[datetime, datetime]] = []

    def patch(self):
        fake = self

        async def read(push: CookidooPush, start: datetime, end: datetime) -> dict[str, Any]:
            fake.calls.append((start, end))
            return {push.entity_id: {"events": fake.events}}

        return patch.object(CookidooPush, "async_read_events", read)


def _pushes(mock_api) -> list[Any]:
    return [c for c in mock_api.mock_calls if c[0] == "POST" and str(c[1]).endswith("/cookidoo")]


def test_events_payload() -> None:
    out = events_payload({"calendar.x": {"events": [*EVENTS, {"start": "", "summary": "x"}, {"start": "2026-10-14", "summary": "  "}]}}, "calendar.x")
    assert out == [
        {"date": "2026-10-12", "summary": "Köttbullar mit Pilzsauce", "description": "Total Time: 4200.0"},
        {"date": "2026-10-13", "summary": "Reistopf", "description": "Total Time: 1800.0"},
    ]
    dt = datetime(2026, 10, 12, 18, 0, tzinfo=dt_util.UTC)
    assert events_payload({"calendar.x": {"events": [{"start": dt, "summary": "A"}]}}, "calendar.x")[0]["date"] == dt_util.as_local(dt).date().isoformat()


async def test_push_on_setup_and_change(hass: HomeAssistant, mock_api, entry) -> None:
    hass.states.async_set(DEFAULT_COOKIDOO_ENTITY, "off")
    cal = FakeCalendar(EVENTS)
    mock_api.post(f"{API}/cookidoo", json={"events": 2, "added": 2, "updated": 0, "removed": 0, "imported": 0})
    with cal.patch():
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

        assert cal.calls
        pushes = _pushes(mock_api)
        assert len(pushes) == 1
        body = pushes[0][2]
        assert body["entity_id"] == DEFAULT_COOKIDOO_ENTITY
        assert [e["summary"] for e in body["events"]] == ["Köttbullar mit Pilzsauce", "Reistopf"]
        assert body["start"] == dt_util.now().date().isoformat()
        assert date.fromisoformat(body["end"]) > date.fromisoformat(body["start"])
        assert entry.runtime_data.cookidoo.last_result["added"] == 2

        # state change with identical events → nothing new is sent
        hass.states.async_set(DEFAULT_COOKIDOO_ENTITY, "on")
        await hass.async_block_till_done()
        assert len(_pushes(mock_api)) == 1

        # Cookidoo changed → pushed again
        cal.events = [EVENTS[0]]
        hass.states.async_set(DEFAULT_COOKIDOO_ENTITY, "off")
        await hass.async_block_till_done()
        assert len(_pushes(mock_api)) == 2
        assert len(_pushes(mock_api)[-1][2]["events"]) == 1

        # the 3-hourly run always sends
        await entry.runtime_data.cookidoo.async_push(force=True)
        assert len(_pushes(mock_api)) == 3


async def test_waits_for_the_calendar_to_appear(hass: HomeAssistant, mock_api, entry) -> None:
    mock_api.post(f"{API}/cookidoo", json={"events": 2, "added": 2, "updated": 0, "removed": 0, "imported": 0})
    with FakeCalendar(EVENTS).patch():
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        assert _pushes(mock_api) == []
        hass.states.async_set(DEFAULT_COOKIDOO_ENTITY, "off")
        await hass.async_block_till_done()
        assert len(_pushes(mock_api)) == 1


async def test_switched_off(hass: HomeAssistant, mock_api, entry) -> None:
    entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(entry, options={CONF_LIVE_UPDATES: False, CONF_COOKIDOO_SYNC: False})
    hass.states.async_set(DEFAULT_COOKIDOO_ENTITY, "off")
    with FakeCalendar(EVENTS).patch():
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    assert _pushes(mock_api) == []
    assert entry.runtime_data.cookidoo is None


async def test_old_server(hass: HomeAssistant, mock_api, entry) -> None:
    hass.states.async_set(DEFAULT_COOKIDOO_ENTITY, "off")
    mock_api.post(f"{API}/cookidoo", status=404, json={"error": "not found"})
    with FakeCalendar(EVENTS).patch():
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        push = entry.runtime_data.cookidoo
        assert push.last_result is None
        assert await push.async_push(force=True) is None
    assert len(_pushes(mock_api)) == 1

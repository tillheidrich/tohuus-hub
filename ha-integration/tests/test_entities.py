"""Entity, service and event tests against a fake ToHuus Hub."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from homeassistant.components.todo import DOMAIN as TODO_DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from pytest_homeassistant_custom_component.common import async_capture_events

from custom_components.tohuus_hub.const import DOMAIN, EVENT_TOHUUS

from .conftest import API


async def _setup(hass: HomeAssistant, entry) -> None:
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def test_sensors(hass: HomeAssistant, mock_api, entry, state: dict[str, Any]) -> None:
    await _setup(hass, entry)
    low = hass.states.get("sensor.tohuus_hub_products_low")
    assert low is not None
    assert int(low.state) == state["counts"]["low"]
    assert [i["name"] for i in low.attributes["items"]] == [i["name"] for i in state["low"]]
    assert hass.states.get("sensor.tohuus_hub_shopping_list").state == str(state["counts"]["shopping"])
    assert hass.states.get("sensor.tohuus_hub_tonight").state == state["tonight"]["title"]
    assert hass.states.get("sensor.tohuus_hub_party").state == "off"
    assert hass.states.get("binary_sensor.tohuus_hub_party_running").state == "off"
    assert hass.states.get("binary_sensor.tohuus_hub_something_expired").state == ("on" if state["counts"]["expired"] else "off")
    nxt = hass.states.get("sensor.tohuus_hub_next_care_task")
    assert nxt.state.startswith(state["care"]["next"]["next_due"]) or nxt.state.endswith("+00:00")
    assert hass.states.get("button.tohuus_hub_fill_week") is not None
    assert hass.states.get("calendar.tohuus_hub_meal_plan") is not None
    assert hass.states.get("event.tohuus_hub_notification") is not None


async def test_todo(hass: HomeAssistant, mock_api, entry, state: dict[str, Any]) -> None:
    await _setup(hass, entry)
    todo = hass.states.get("todo.tohuus_hub_shopping_list")
    assert int(todo.state) == sum(1 for i in state["todo"] if i["status"] == "needs_action")

    mock_api.post(f"{API}/todo", json={"items": [{"uid": "99", "summary": "Milk", "created": True}]})
    await hass.services.async_call(TODO_DOMAIN, "add_item", {"item": "Milk"}, target={"entity_id": "todo.tohuus_hub_shopping_list"}, blocking=True)
    posts = [c for c in mock_api.mock_calls if c[0] == "POST" and str(c[1]).endswith("/todo")]
    assert posts and posts[-1][2] == {"summary": "Milk", "description": None}

    first = state["todo"][0]
    mock_api.patch(f"{API}/todo/{first['uid']}", json={**first, "status": "completed"})
    await hass.services.async_call(TODO_DOMAIN, "update_item", {"item": first["summary"], "status": "completed"}, target={"entity_id": "todo.tohuus_hub_shopping_list"}, blocking=True)
    patches = [c for c in mock_api.mock_calls if c[0] == "PATCH"]
    assert patches[-1][2]["status"] == "completed"


async def test_services(hass: HomeAssistant, mock_api, entry) -> None:
    await _setup(hass, entry)
    mock_api.post(f"{API}/services/add_to_shopping_list", json={"items": [{"id": 5, "text": "Bread", "created": True}]})
    res = await hass.services.async_call(DOMAIN, "add_to_shopping_list", {"text": "Bread"}, blocking=True, return_response=True)
    assert res == {"items": [{"id": 5, "text": "Bread", "created": True}]}
    call = [c for c in mock_api.mock_calls if str(c[1]).endswith("/services/add_to_shopping_list")][-1]
    assert call[2] == {"text": "Bread"}  # None values are not sent

    mock_api.post(f"{API}/services/consume", status=404, json={"error": "Product not found"})
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "consume", {"product": "Unicorn milk"}, blocking=True)

    mock_api.post(f"{API}/services/order", json={"id": 3})
    await hass.services.async_call(DOMAIN, "order", {"product": "Cola", "quantity": 2, "note": "Sofa"}, blocking=True)
    call = [c for c in mock_api.mock_calls if str(c[1]).endswith("/services/order")][-1]
    assert call[2] == {"items": [{"product": "Cola", "qty": 2, "options": []}], "note": "Sofa"}

    mock_api.post(f"{API}/services/plan_meal", json={"id": 1, "day": "2026-10-12"})
    await hass.services.async_call(DOMAIN, "plan_meal", {"title": "Pizza", "date": "2026-10-12", "slot": "lunch"}, blocking=True)
    call = [c for c in mock_api.mock_calls if str(c[1]).endswith("/services/plan_meal")][-1]
    assert call[2] == {"title": "Pizza", "day": "2026-10-12", "slot": "lunch"}

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "plan_meal", {}, blocking=True)


async def test_events_fire_on_bus(hass: HomeAssistant, mock_api, entry) -> None:
    await _setup(hass, entry)
    events = async_capture_events(hass, EVENT_TOHUUS)
    coordinator = entry.runtime_data.coordinator
    coordinator._fire({"event": "order.new", "title": "Order from Till", "message": "1× Cola", "url": "http://x/bar", "data": {"order_id": 1}})
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["event"] == "order.new"
    assert events[0].data["type"] == "order_new"
    assert events[0].data["config_entry_id"] == entry.entry_id
    ev = hass.states.get("event.tohuus_hub_notification")
    assert ev.attributes["event_type"] == "order_new"
    assert ev.attributes["title"] == "Order from Till"


async def test_sse_parser() -> None:
    """The event stream parser turns SSE frames into (event, data)."""
    from custom_components.tohuus_hub.api import ToHuusApi

    frames = [
        b"retry: 5000\n", b"event: hello\n", b'data: {"api":1}\n', b"\n",
        b": ping\n", b"\n",
        b"event: change\n", b'data: {"topics":["shopping"]}\n', b"\n",
        b"event: tohuus\n", b'data: {"event":"stock.low"}\n', b"\n",
    ]

    class Content:
        def __aiter__(self):
            self._it = iter(frames)
            return self

        async def __anext__(self):
            try:
                return next(self._it)
            except StopIteration as err:
                raise StopAsyncIteration from err

    class Resp:
        status = 200
        content = Content()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Session:
        def get(self, *a, **kw):
            return Resp()

    api = ToHuusApi(Session(), "http://x", "t")  # type: ignore[arg-type]
    got = [e async for e in api.events()]
    assert got == [("hello", {"api": 1}), ("change", {"topics": ["shopping"]}), ("tohuus", {"event": "stock.low"})]


async def test_auth_failure_starts_reauth(hass: HomeAssistant, aioclient_mock, entry) -> None:
    aioclient_mock.get(f"{API}/info", status=401, json={"error": "unauthorized"})
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    flows = hass.config_entries.flow.async_progress()
    assert any(f["context"]["source"] == "reauth" for f in flows)


async def test_diagnostics(hass: HomeAssistant, mock_api, entry) -> None:
    from custom_components.tohuus_hub.diagnostics import async_get_config_entry_diagnostics

    await _setup(hass, entry)
    diag = await async_get_config_entry_diagnostics(hass, entry)
    assert diag["entry"]["data"]["token"] == "**REDACTED**"
    assert diag["counts"]["low"] >= 0
    with patch.object(entry.runtime_data.coordinator, "live", True):
        assert (await async_get_config_entry_diagnostics(hass, entry))["live_updates_connected"] is True

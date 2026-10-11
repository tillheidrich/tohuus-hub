"""Two-way bridge: capabilities, snapshots, operations with acknowledgements, NFC tags."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_capture_events
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMockResponse

from custom_components.tohuus_hub.bridge import Bridge
from custom_components.tohuus_hub.const import CONF_BRIDGE, EVENT_TAG_RESULT

from .conftest import API, load


class FakeHub:
    """A tiny ToHuus Hub: asks to watch the shopping list, then hands out operations once."""

    def __init__(self) -> None:
        self.bodies: list[dict[str, Any]] = []
        self.ops_sent = False

    async def __call__(self, method: str, url: Any, data: Any) -> AiohttpClientMockResponse:
        body = dict(data or {})
        self.bodies.append(body)
        config = {"todo": ["todo.shopping_list"], "calendar": [], "persons": True, "tags": True, "want_capabilities": False}
        ops: list[dict[str, Any]] = []
        if body.get("todo", {}).get("todo.shopping_list") is not None and not self.ops_sent:
            self.ops_sent = True
            ops = [
                {"id": 1, "topic": "shopping", "op": {"kind": "todo", "service": "add_item", "entity_id": "todo.shopping_list", "item": "Oat milk"}},
                {"id": 2, "topic": "notify", "op": {"kind": "notify", "service": "mobile_app_test_phone", "title": "Hi", "message": "Milk is low", "data": {"url": "http://x"}}},
                {"id": 3, "topic": "shopping", "op": {"kind": "todo", "service": "remove_item", "entity_id": "todo.missing", "uid": "nope"}},
            ]
        return AiohttpClientMockResponse(method, url, json={"config": config, "ops": ops})


async def _setup(hass: HomeAssistant, aioclient_mock, entry: MockConfigEntry, hub: FakeHub) -> Bridge:
    aioclient_mock.get(f"{API}/info", json=load("info.json"))
    aioclient_mock.get(f"{API}/state", json=load("state.json"))
    aioclient_mock.get(f"{API}/calendar/meals", json={"events": []})
    aioclient_mock.get(f"{API}/calendar/care", json={"events": []})
    aioclient_mock.post(f"{API}/bridge/sync", side_effect=hub)
    aioclient_mock.post(f"{API}/bridge/tag", json={"ok": True, "message": "Sparkling water: one less"})
    # a real HA shopping list (todo.shopping_list) to sync with – it stores into the shared test config dir
    Path(hass.config.path(".shopping_list.json")).unlink(missing_ok=True)
    sl = MockConfigEntry(domain="shopping_list")
    sl.add_to_hass(hass)
    assert await hass.config_entries.async_setup(sl.entry_id)
    hass.states.async_set("person.till", "home", {"friendly_name": "Till", "user_id": "abc"})
    hass.states.async_set("light.kitchen", "on", {"friendly_name": "Kitchen light"})
    hass.states.async_set("lock.front_door", "locked", {"friendly_name": "Front door"})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data.bridge


async def test_bridge_round_trip(hass: HomeAssistant, aioclient_mock, entry) -> None:
    notified: list[ServiceCall] = []

    async def _notify(call: ServiceCall) -> None:
        notified.append(call)

    hass.services.async_register("notify", "mobile_app_test_phone", _notify)
    hub = FakeHub()
    bridge = await _setup(hass, aioclient_mock, entry, hub)
    assert bridge is not None
    await bridge.async_sync("test")
    await hass.async_block_till_done()

    first = hub.bodies[0]
    caps = first["capabilities"]
    assert any(t["entity_id"] == "todo.shopping_list" and t["platform"] == "shopping_list" and t["writable"] for t in caps["todo"])
    assert any(t["entity_id"].startswith("todo.tohuus_hub") for t in caps["todo"])  # ToHuus Hub filters its own list out
    assert "mobile_app_test_phone" in caps["notify"]
    assert [v["entity_id"] for v in caps["voice"]] == ["light.kitchen"]  # locks are not even reported
    assert caps["person"][0]["name"] == "Till"

    # the operations ran: item added to the real HA list, phone notified, the broken op acknowledged as failed
    items = (await hass.services.async_call("todo", "get_items", {"entity_id": "todo.shopping_list"}, blocking=True, return_response=True))["todo.shopping_list"]["items"]
    assert [i["summary"] for i in items] == ["Oat milk"]
    assert notified and notified[0].data["message"] == "Milk is low"
    acks = next(b["acks"] for b in hub.bodies if b.get("acks"))
    assert acks[0] == {"id": 1, "ok": True, "uid": items[0]["uid"]}
    assert acks[1]["ok"] is True
    assert acks[2]["ok"] is False
    # the round that carried the acks also carried a fresh snapshot with the new item
    with_acks = next(b for b in hub.bodies if b.get("acks"))
    assert [i["summary"] for i in with_acks["todo"]["todo.shopping_list"]["items"]] == ["Oat milk"]
    assert with_acks["persons"][0]["state"] == "home"


async def test_bridge_tag_scan(hass: HomeAssistant, aioclient_mock, entry) -> None:
    hub = FakeHub()
    await _setup(hass, aioclient_mock, entry, hub)
    results = async_capture_events(hass, EVENT_TAG_RESULT)
    hass.bus.async_fire("tag_scanned", {"tag_id": "fridge-1", "name": "Fridge", "device_id": None})
    await hass.async_block_till_done()
    posted = [c for c in aioclient_mock.mock_calls if str(c[1]).endswith("/bridge/tag")]
    assert posted and posted[-1][2]["tag_id"] == "fridge-1"
    assert results and results[0].data == {"tag_id": "fridge-1", "ok": True, "message": "Sparkling water: one less"}


async def test_bridge_switched_off(hass: HomeAssistant, aioclient_mock, entry) -> None:
    entry = MockConfigEntry(domain=entry.domain, title=entry.title, unique_id=entry.unique_id, data=dict(entry.data), options={**entry.options, CONF_BRIDGE: False})
    hub = FakeHub()
    bridge = await _setup(hass, aioclient_mock, entry, hub)
    assert bridge is None
    assert hub.bodies == []


async def test_bridge_old_server(hass: HomeAssistant, aioclient_mock, entry) -> None:
    aioclient_mock.get(f"{API}/info", json=load("info.json"))
    aioclient_mock.get(f"{API}/state", json=load("state.json"))
    aioclient_mock.get(f"{API}/calendar/meals", json={"events": []})
    aioclient_mock.get(f"{API}/calendar/care", json={"events": []})
    aioclient_mock.post(f"{API}/bridge/sync", status=404, json={"error": "not found"})
    assert await async_setup_component(hass, "persistent_notification", {})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    bridge = entry.runtime_data.bridge
    assert bridge.supported is False
    # no further calls once the server said it doesn't know the bridge
    before = len(aioclient_mock.mock_calls)
    await bridge.async_sync("again")
    assert len(aioclient_mock.mock_calls) == before

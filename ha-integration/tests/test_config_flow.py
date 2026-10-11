"""Config flow tests."""

from __future__ import annotations

from homeassistant import config_entries
from homeassistant.const import CONF_TOKEN, CONF_URL, CONF_VERIFY_SSL
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.tohuus_hub.const import DOMAIN

from .conftest import API, URL, load


async def test_user_flow(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{API}/info", json=load("info.json"))
    aioclient_mock.get(f"{API}/state", json=load("state.json"))
    aioclient_mock.post(f"{API}/bridge/sync", json={"config": {}, "ops": []})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: "tohuus.local:8080/", CONF_TOKEN: " sw_test ", CONF_VERIFY_SSL: True})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Test home"
    assert result["data"] == {CONF_URL: URL, CONF_TOKEN: "sw_test", CONF_VERIFY_SSL: True}
    assert result["result"].unique_id == "test-instance"


async def test_user_flow_invalid_auth(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{API}/info", status=403, json={"error": "This access is meant for MCP only."})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: URL, CONF_TOKEN: "sw_bad", CONF_VERIFY_SSL: True})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_auth"}


async def test_user_flow_old_server(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{API}/info", status=404, json={"error": "not found"})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: URL, CONF_TOKEN: "sw_x", CONF_VERIFY_SSL: True})
    assert result["errors"] == {"base": "not_supported"}


async def test_user_flow_cannot_connect(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{API}/info", exc=TimeoutError())
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: URL, CONF_TOKEN: "sw_x", CONF_VERIFY_SSL: True})
    assert result["errors"] == {"base": "cannot_connect"}


async def test_options_flow(hass: HomeAssistant, mock_api, entry) -> None:
    entry.add_to_hass(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {"features": ["todo"], "live_updates": False, "display_mode": "bw", "display_width": 400.0, "display_height": 300.0},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options["display_width"] == 400
    await hass.async_block_till_done()
    # calendars switched off → no calendar entities after the reload
    assert hass.states.get("calendar.tohuus_hub_meal_plan") is None
    assert hass.states.get("todo.tohuus_hub_shopping_list") is not None

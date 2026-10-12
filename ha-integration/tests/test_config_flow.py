"""Config flow tests: ToHuus Cloud / own server, pairing code or token, reauth."""

from __future__ import annotations

from homeassistant import config_entries
from homeassistant.const import CONF_TOKEN, CONF_URL, CONF_VERIFY_SSL
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.tohuus_hub.const import CLOUD_URL, CONF_CODE, CONF_SERVER, DOMAIN

from .conftest import API, URL, load

CLOUD_API = f"{CLOUD_URL}/api/ha/v1"


async def _own_server(hass: HomeAssistant):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["cloud", "own_server"]
    return await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "own_server"})


def _mock_server(aioclient_mock, api: str = API) -> None:
    aioclient_mock.get(f"{api}/info", json=load("info.json"))
    aioclient_mock.get(f"{api}/state", json=load("state.json"))
    aioclient_mock.post(f"{api}/bridge/sync", json={"config": {}, "ops": []})


async def test_cloud_with_code(hass: HomeAssistant, aioclient_mock) -> None:
    _mock_server(aioclient_mock, CLOUD_API)
    aioclient_mock.post(f"{CLOUD_URL}/api/ha/pair/claim", json={"token": "sw_hcloud_abc", "instance_id": "test-instance", "household": "Familie Berg", "mode": "cloud"})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "cloud"})
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "cloud"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_CODE: " abcd-efgh "})
    assert result["type"] is FlowResultType.CREATE_ENTRY, result
    assert result["data"] == {CONF_URL: CLOUD_URL, CONF_TOKEN: "sw_hcloud_abc", CONF_VERIFY_SSL: True, CONF_SERVER: "cloud"}
    claim = [c for c in aioclient_mock.mock_calls if str(c[1]).endswith("/pair/claim")][-1]
    assert claim[2]["code"] == "abcd-efgh"
    assert claim[2]["name"]  # the HA location name, shown in ToHuus' access list


async def test_cloud_invalid_code(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.post(f"{CLOUD_URL}/api/ha/pair/claim", status=404, json={"error": "This code is not valid", "code": "invalid_code"})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "cloud"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_CODE: "ZZZZ-ZZZZ"})
    assert result["errors"] == {"base": "invalid_code"}


async def test_cloud_rate_limited(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.post(f"{CLOUD_URL}/api/ha/pair/claim", status=429, json={"error": "Too many", "code": "too_many_attempts"})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "cloud"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_CODE: "ABCD-EFGH"})
    assert result["errors"] == {"base": "too_many_attempts"}


async def test_own_server_with_code(hass: HomeAssistant, aioclient_mock) -> None:
    _mock_server(aioclient_mock)
    aioclient_mock.post(f"{URL}/api/ha/pair/claim", json={"token": "sw_paired", "instance_id": "test-instance", "mode": "selfhost"})
    result = await _own_server(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: "tohuus.local:8080/", CONF_CODE: "ABCD-EFGH", CONF_VERIFY_SSL: True})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Test home"
    assert result["data"] == {CONF_URL: URL, CONF_TOKEN: "sw_paired", CONF_VERIFY_SSL: True, CONF_SERVER: "own"}
    assert result["result"].unique_id == "test-instance"


async def test_own_server_with_token(hass: HomeAssistant, aioclient_mock) -> None:
    _mock_server(aioclient_mock)
    result = await _own_server(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: "tohuus.local:8080/", CONF_TOKEN: " sw_test ", CONF_VERIFY_SSL: True})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_TOKEN] == "sw_test"


async def test_own_server_old_server_without_pairing(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.post(f"{URL}/api/ha/pair/claim", status=401, json={"error": "unauthorized"})
    result = await _own_server(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: URL, CONF_CODE: "ABCD-EFGH", CONF_VERIFY_SSL: True})
    assert result["errors"] == {"base": "pairing_not_supported"}


async def test_own_server_needs_code_or_token(hass: HomeAssistant, aioclient_mock) -> None:
    result = await _own_server(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: URL, CONF_VERIFY_SSL: True})
    assert result["errors"] == {"base": "code_or_token"}


async def test_user_flow_invalid_auth(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{API}/info", status=403, json={"error": "This access is meant for MCP only."})
    result = await _own_server(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: URL, CONF_TOKEN: "sw_bad", CONF_VERIFY_SSL: True})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_auth"}


async def test_user_flow_old_server(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{API}/info", status=404, json={"error": "not found"})
    result = await _own_server(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: URL, CONF_TOKEN: "sw_x", CONF_VERIFY_SSL: True})
    assert result["errors"] == {"base": "not_supported"}


async def test_user_flow_cannot_connect(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{API}/info", exc=TimeoutError())
    result = await _own_server(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: URL, CONF_TOKEN: "sw_x", CONF_VERIFY_SSL: True})
    assert result["errors"] == {"base": "cannot_connect"}


async def test_reauth_with_code(hass: HomeAssistant, mock_api, entry) -> None:
    entry.add_to_hass(hass)
    mock_api.post(f"{URL}/api/ha/pair/claim", json={"token": "sw_new", "instance_id": "test-instance"})
    result = await entry.start_reauth_flow(hass)
    assert result["step_id"] == "reauth_confirm"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_CODE: "ABCD-EFGH"})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reauth_successful"
    assert entry.data[CONF_TOKEN] == "sw_new"


async def test_options_flow(hass: HomeAssistant, mock_api, entry) -> None:
    entry.add_to_hass(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {"features": ["todo"], "live_updates": False, "display_mode": "bw", "display_width": 400.0, "display_height": 300.0, "notify_services": ["notify.kitchen_tv"], "notify_events": ["order_new"]},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options["display_width"] == 400
    assert entry.options["notify_services"] == ["notify.kitchen_tv"]
    await hass.async_block_till_done()
    # calendars switched off → no calendar entities after the reload
    assert hass.states.get("calendar.tohuus_hub_meal_plan") is None
    assert hass.states.get("todo.tohuus_hub_shopping_list") is not None

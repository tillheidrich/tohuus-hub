"""Diagnostics: config (token redacted), what the integration sees, whether live updates run."""

from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.const import CONF_TOKEN, CONF_URL
from homeassistant.core import HomeAssistant

from .coordinator import ToHuusConfigEntry

from .const import CONF_NOTIFY_SERVICES

# never in a diagnostics file: the access token, addresses (own servers live at home), names that can be people's
# (household name, notify services named after phones), guest links. Hausinfo codes never reach the integration at all.
TO_REDACT = {CONF_TOKEN, CONF_URL, CONF_NOTIFY_SERVICES, "guest_url", "instance_id", "household", "base_url", "name"}


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ToHuusConfigEntry) -> dict[str, Any]:
    """Return diagnostics for a config entry."""
    rt = entry.runtime_data
    data = rt.coordinator.data or {}
    return {
        "entry": {"data": async_redact_data(dict(entry.data), TO_REDACT), "options": async_redact_data(dict(entry.options), TO_REDACT)},
        "info": async_redact_data(rt.info, TO_REDACT),
        "live_updates_connected": rt.coordinator.live,
        "last_update_success": rt.coordinator.last_update_success,
        "counts": data.get("counts"),
        "api": data.get("api"),
        "displays": len(data.get("displays") or []),
        "has": {k: k in data for k in ("due", "money", "sync")},
        "sync": {k: (v or {}).get("mode") for k, v in (data.get("sync") or {}).items()},
        "cookidoo": {
            "entity_id": rt.cookidoo.entity_id,
            "last_result": rt.cookidoo.last_result,
            "last_error": rt.cookidoo.last_error,
        }
        if rt.cookidoo
        else None,
        "bridge": {
            "supported": rt.bridge.supported,
            "watching": rt.bridge.config,
            "last_sync": rt.bridge.last_sync.isoformat() if rt.bridge.last_sync else None,
            "last_error": rt.bridge.last_error,
        }
        if rt.bridge
        else None,
    }

"""Diagnostics: config (token redacted), what the integration sees, whether live updates run."""

from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.const import CONF_TOKEN
from homeassistant.core import HomeAssistant

from .coordinator import ToHuusConfigEntry

TO_REDACT = {CONF_TOKEN, "guest_url", "instance_id"}


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ToHuusConfigEntry) -> dict[str, Any]:
    """Return diagnostics for a config entry."""
    rt = entry.runtime_data
    data = rt.coordinator.data or {}
    return {
        "entry": {"data": async_redact_data(dict(entry.data), TO_REDACT), "options": dict(entry.options)},
        "info": async_redact_data(rt.info, TO_REDACT),
        "live_updates_connected": rt.coordinator.live,
        "last_update_success": rt.coordinator.last_update_success,
        "counts": data.get("counts"),
        "api": data.get("api"),
        "displays": data.get("displays"),
        "party": async_redact_data(data.get("party") or {}, TO_REDACT),
        "cookidoo": {
            "entity_id": rt.cookidoo.entity_id,
            "last_result": rt.cookidoo.last_result,
            "last_error": rt.cookidoo.last_error,
        }
        if rt.cookidoo
        else None,
    }

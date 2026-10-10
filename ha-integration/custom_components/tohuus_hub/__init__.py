"""The ToHuus Hub integration: household stock, shopping list, meal plan and care tasks in Home Assistant."""

from __future__ import annotations

from homeassistant.const import CONF_TOKEN, CONF_URL, CONF_VERIFY_SSL, Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from .api import ToHuusApi, ToHuusAuthError, ToHuusError
from .const import DOMAIN, FEATURE_BUTTONS, FEATURE_CALENDARS, FEATURE_DISPLAYS, FEATURE_EVENTS, FEATURE_TODO
from .coordinator import ToHuusConfigEntry, ToHuusCoordinator, ToHuusRuntimeData
from .entity import feature_enabled
from .services import async_setup_services

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.CALENDAR,
    Platform.EVENT,
    Platform.IMAGE,
    Platform.SENSOR,
    Platform.TODO,
]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

# unique_id suffixes per optional feature (sensors are always on)
FEATURE_KEYS: dict[str, tuple[str, ...]] = {
    FEATURE_TODO: ("shopping_list_todo",),
    FEATURE_CALENDARS: ("meal_plan", "care_tasks"),
    FEATURE_DISPLAYS: ("display_",),
    FEATURE_BUTTONS: ("check_receipt_inbox", "fill_week", "backup_now"),
    FEATURE_EVENTS: ("notification",),
}


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the services once (they work across all ToHuus Hub entries)."""
    async_setup_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ToHuusConfigEntry) -> bool:
    """Set up ToHuus Hub from a config entry."""
    session = async_get_clientsession(hass, verify_ssl=entry.data.get(CONF_VERIFY_SSL, True))
    api = ToHuusApi(session, entry.data[CONF_URL], entry.data[CONF_TOKEN])
    try:
        info = await api.info()
    except ToHuusAuthError as err:
        raise ConfigEntryAuthFailed(str(err)) from err
    except ToHuusError as err:
        raise ConfigEntryNotReady(str(err)) from err

    coordinator = ToHuusCoordinator(hass, entry, api)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = ToHuusRuntimeData(api=api, coordinator=coordinator, info=info)
    _remove_stale_entities(hass, entry)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    coordinator.start_listener()
    entry.async_on_unload(coordinator.stop_listener)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


def _remove_stale_entities(hass: HomeAssistant, entry: ToHuusConfigEntry) -> None:
    """Drop entities of features switched off in the options and of displays deleted in ToHuus Hub."""
    registry = er.async_get(hass)
    prefix = f"{entry.unique_id or entry.entry_id}_"
    off = [k for f, keys in FEATURE_KEYS.items() if not feature_enabled(entry, f) for k in keys]
    displays = {f"display_{d.get('id')}" for d in (entry.runtime_data.coordinator.data or {}).get("displays") or []}
    for ent in er.async_entries_for_config_entry(registry, entry.entry_id):
        key = ent.unique_id.removeprefix(prefix)
        if any(key == k or (k.endswith("_") and key.startswith(k)) for k in off) or (key.startswith("display_") and key not in displays):
            registry.async_remove(ent.entity_id)


async def _async_reload(hass: HomeAssistant, entry: ToHuusConfigEntry) -> None:
    """Options changed (features, live updates): reload."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ToHuusConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

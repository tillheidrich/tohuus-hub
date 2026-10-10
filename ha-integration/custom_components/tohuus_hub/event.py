"""Event entity: the latest ToHuus Hub notification (also fired on the bus as tohuus_hub_event)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import EVENT_TYPES, FEATURE_EVENTS
from .coordinator import ToHuusConfigEntry, ToHuusCoordinator
from .entity import ToHuusEntity, feature_enabled


async def async_setup_entry(hass: HomeAssistant, entry: ToHuusConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Set up the notification event entity."""
    if feature_enabled(entry, FEATURE_EVENTS):
        async_add_entities([ToHuusNotificationEvent(entry.runtime_data.coordinator)])


class ToHuusNotificationEvent(ToHuusEntity, EventEntity):
    """Shows up in the logbook and can trigger automations from the UI ("Event: ToHuus Hub notification")."""

    _platform_domain = "event"

    _attr_translation_key = "notification"
    _attr_event_types = [e.replace(".", "_") for e in EVENT_TYPES]

    def __init__(self, coordinator: ToHuusCoordinator) -> None:
        super().__init__(coordinator, "notification")

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.coordinator.event_callbacks.add(self._on_event)
        self.async_on_remove(lambda: self.coordinator.event_callbacks.discard(self._on_event))

    @callback
    def _on_event(self, payload: dict[str, Any]) -> None:
        etype = payload.get("type")
        if etype not in self._attr_event_types:
            return
        self._trigger_event(etype, {k: payload.get(k) for k in ("title", "message", "url", "data")})
        self.async_write_ha_state()

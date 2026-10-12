"""Who leads per topic (shopping list, meal plan, care): Home Assistant, ToHuus, both – or off.

The same setting as in ToHuus (Settings › Home Assistant). Which HA lists/calendars take part is chosen there.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import ToHuusError
from .const import CONF_BRIDGE, DOMAIN, LEADER_OPTIONS, LEADER_TOPICS
from .coordinator import ToHuusConfigEntry, ToHuusCoordinator
from .entity import ToHuusEntity

TO_WIRE = {v: k for k, v in LEADER_OPTIONS.items()}


async def async_setup_entry(hass: HomeAssistant, entry: ToHuusConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """One select per topic – only with the two-way bridge on and a ToHuus Hub that reports it."""
    coordinator = entry.runtime_data.coordinator
    sync = (coordinator.data or {}).get("sync")
    if not entry.options.get(CONF_BRIDGE, True) or not isinstance(sync, dict):
        return
    async_add_entities(ToHuusLeaderSelect(coordinator, topic) for topic in LEADER_TOPICS if topic in sync)


class ToHuusLeaderSelect(ToHuusEntity, SelectEntity):
    """off / both / home_assistant / tohuus – the modes ToHuus offers for this topic."""

    _platform_domain = "select"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: ToHuusCoordinator, topic: str) -> None:
        super().__init__(coordinator, f"leader_{topic}")
        self._topic = topic
        self._attr_translation_key = f"leader_{topic}"
        self._attr_icon = {"shopping": "mdi:cart-arrow-right", "meals": "mdi:calendar-sync", "care": "mdi:wrench-clock"}.get(topic)

    @property
    def _sync(self) -> dict[str, Any]:
        return (self.data.get("sync") or {}).get(self._topic) or {}

    @property
    def options(self) -> list[str]:
        modes = self._sync.get("modes") or list(LEADER_OPTIONS)
        return [LEADER_OPTIONS[m] for m in modes if m in LEADER_OPTIONS]

    @property
    def current_option(self) -> str | None:
        return LEADER_OPTIONS.get(self._sync.get("mode") or "off")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"entities": self._sync.get("entities") or []}

    async def async_select_option(self, option: str) -> None:
        try:
            await self.coordinator.api.set_leader(self._topic, TO_WIRE[option])
        except (ToHuusError, KeyError) as err:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="request_failed", translation_placeholders={"error": str(err)}) from err
        await self.coordinator.async_request_refresh()

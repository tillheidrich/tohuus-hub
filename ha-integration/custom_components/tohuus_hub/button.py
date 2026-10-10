"""Buttons: check the receipt inbox, fill the week, back up now."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.components.button import ButtonEntity, ButtonEntityDescription
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import ToHuusError
from .const import DOMAIN, FEATURE_BUTTONS
from .coordinator import ToHuusConfigEntry, ToHuusCoordinator
from .entity import ToHuusEntity, feature_enabled


@dataclass(frozen=True, kw_only=True)
class ToHuusButtonDescription(ButtonEntityDescription):
    """A button that calls one /services endpoint."""

    service: str


BUTTONS: tuple[ToHuusButtonDescription, ...] = (
    ToHuusButtonDescription(key="check_receipt_inbox", translation_key="check_receipt_inbox", icon="mdi:email-sync-outline", service="check_receipt_inbox"),
    ToHuusButtonDescription(key="fill_week", translation_key="fill_week", icon="mdi:calendar-star", service="fill_week"),
    ToHuusButtonDescription(key="backup_now", translation_key="backup_now", icon="mdi:database-export-outline", service="backup_now", entity_category=EntityCategory.CONFIG),
)


async def async_setup_entry(hass: HomeAssistant, entry: ToHuusConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Set up buttons."""
    if feature_enabled(entry, FEATURE_BUTTONS):
        coordinator = entry.runtime_data.coordinator
        async_add_entities(ToHuusButton(coordinator, d) for d in BUTTONS)


class ToHuusButton(ToHuusEntity, ButtonEntity):
    """Press → ToHuus Hub does it."""

    _platform_domain = "button"

    entity_description: ToHuusButtonDescription

    def __init__(self, coordinator: ToHuusCoordinator, description: ToHuusButtonDescription) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    async def async_press(self) -> None:
        try:
            result = await self.coordinator.api.service(self.entity_description.service)
        except ToHuusError as err:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="request_failed", translation_placeholders={"error": str(err)}) from err
        # e.g. the receipt inbox isn't set up yet – ToHuus Hub explains it in plain words
        if isinstance(result, dict) and result.get("ok") is False:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="request_failed", translation_placeholders={"error": str(result.get("message") or "")})
        await self.coordinator.async_request_refresh()

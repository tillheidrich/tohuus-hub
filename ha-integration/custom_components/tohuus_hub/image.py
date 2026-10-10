"""Kitchen displays (ToHuus Hub › Displays) as image entities – for picture cards and wall tablets."""

from __future__ import annotations

from homeassistant.components.image import ImageEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .api import ToHuusError
from .const import (
    CONF_DISPLAY_HEIGHT,
    CONF_DISPLAY_MODE,
    CONF_DISPLAY_WIDTH,
    DEFAULT_DISPLAY_HEIGHT,
    DEFAULT_DISPLAY_MODE,
    DEFAULT_DISPLAY_WIDTH,
    FEATURE_DISPLAYS,
)
from .coordinator import ToHuusConfigEntry, ToHuusCoordinator
from .entity import ToHuusEntity, feature_enabled


async def async_setup_entry(hass: HomeAssistant, entry: ToHuusConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """One image entity per display set up in ToHuus Hub; new displays appear after the next poll."""
    if not feature_enabled(entry, FEATURE_DISPLAYS):
        return
    coordinator = entry.runtime_data.coordinator
    known: set[int] = set()

    @callback
    def add_new() -> None:
        new = [d for d in coordinator.data.get("displays") or [] if d.get("id") not in known]
        if not new:
            return
        known.update(d["id"] for d in new)
        async_add_entities(ToHuusDisplayImage(hass, coordinator, d) for d in new)

    add_new()
    entry.async_on_unload(coordinator.async_add_listener(add_new))


class ToHuusDisplayImage(ToHuusEntity, ImageEntity):
    """The display's PNG, re-rendered by ToHuus Hub whenever household data changes."""

    _platform_domain = "image"

    _attr_translation_key = "display"
    _attr_content_type = "image/png"

    def __init__(self, hass: HomeAssistant, coordinator: ToHuusCoordinator, display: dict) -> None:
        ToHuusEntity.__init__(self, coordinator, f"display_{display['id']}")
        ImageEntity.__init__(self, hass)
        self._display_id = int(display["id"])
        self._attr_translation_placeholders = {"name": str(display.get("name") or display["id"])}
        self._attr_image_last_updated = dt_util.utcnow()
        self._cached: bytes | None = None
        self._generated_at: str | None = None

    @property
    def available(self) -> bool:
        ids = {d.get("id") for d in self.data.get("displays") or []}
        return super().available and self._display_id in ids

    @callback
    def _handle_coordinator_update(self) -> None:
        # a new /state snapshot means something may have changed on the picture
        generated = self.data.get("generated_at")
        if generated != self._generated_at:
            self._generated_at = generated
            self._cached = None
            self._attr_image_last_updated = dt_util.utcnow()
        super()._handle_coordinator_update()

    async def async_image(self) -> bytes | None:
        if self._cached is not None:
            return self._cached
        o = self.coordinator.config_entry.options
        try:
            self._cached = await self.coordinator.api.display_png(
                self._display_id,
                int(o.get(CONF_DISPLAY_WIDTH, DEFAULT_DISPLAY_WIDTH)),
                int(o.get(CONF_DISPLAY_HEIGHT, DEFAULT_DISPLAY_HEIGHT)),
                str(o.get(CONF_DISPLAY_MODE, DEFAULT_DISPLAY_MODE)),
            )
        except ToHuusError:
            return None
        return self._cached

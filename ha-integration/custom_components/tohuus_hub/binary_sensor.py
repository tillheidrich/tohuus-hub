"""Binary sensors: something expired, away mode."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import ToHuusConfigEntry, ToHuusCoordinator
from .entity import ToHuusEntity


@dataclass(frozen=True, kw_only=True)
class ToHuusBinaryDescription(BinarySensorEntityDescription):
    """Describes a ToHuus Hub binary sensor."""

    is_on_fn: Callable[[dict], bool]
    attrs_fn: Callable[[dict], dict[str, Any]] | None = None


BINARY_SENSORS: tuple[ToHuusBinaryDescription, ...] = (
    ToHuusBinaryDescription(
        key="something_expired",
        translation_key="something_expired",
        device_class=BinarySensorDeviceClass.PROBLEM,
        icon="mdi:food-off-outline",
        is_on_fn=lambda d: (d.get("counts") or {}).get("expired", 0) > 0,
        attrs_fn=lambda d: {"items": [i.get("name") for i in (d.get("expiring") or []) if i.get("status") == "expired"][:25]},
    ),
    # away mode (trip) – on while the trip is running; older ToHuus Hubs without "away" stay off
    ToHuusBinaryDescription(
        key="away_mode",
        translation_key="away_mode",
        icon="mdi:bag-suitcase-outline",
        is_on_fn=lambda d: bool((d.get("away") or {}).get("active")),
        attrs_fn=lambda d: {
            "state": (d.get("away") or {}).get("state", "home"),
            "trip": ((d.get("away") or {}).get("trip") or {}).get("name"),
            "start": ((d.get("away") or {}).get("trip") or {}).get("start"),
            "end": ((d.get("away") or {}).get("trip") or {}).get("end"),
            "quiet": bool((d.get("away") or {}).get("quiet")),
            "suggest_start": bool((d.get("away") or {}).get("suggest_start")),
        },
    ),
)


async def async_setup_entry(hass: HomeAssistant, entry: ToHuusConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Set up binary sensors."""
    coordinator = entry.runtime_data.coordinator
    async_add_entities(ToHuusBinarySensor(coordinator, d) for d in BINARY_SENSORS)


class ToHuusBinarySensor(ToHuusEntity, BinarySensorEntity):
    """A binary sensor fed from the /state payload."""

    _platform_domain = "binary_sensor"

    entity_description: ToHuusBinaryDescription
    _unrecorded_attributes = frozenset({"items"})

    def __init__(self, coordinator: ToHuusCoordinator, description: ToHuusBinaryDescription) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def is_on(self) -> bool:
        return self.entity_description.is_on_fn(self.data)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        fn = self.entity_description.attrs_fn
        return fn(self.data) if fn else None

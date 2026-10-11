"""Sensors: counts with item lists as attributes, tonight's meal, next care task, party status."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .coordinator import ToHuusConfigEntry, ToHuusCoordinator
from .entity import ToHuusEntity

# list attributes can get long – keep them out of the recorder database
LIST_ATTRS = frozenset({"items", "tasks", "orders", "wishes", "reasons", "tomorrow", "thaw"})
MAX_ITEMS = 25


def _count(key: str) -> Callable[[dict], Any]:
    return lambda d: (d.get("counts") or {}).get(key, 0)


def _items(*keys: str) -> Callable[[dict], dict[str, Any]]:
    def attrs(d: dict) -> dict[str, Any]:
        out: list[dict] = []
        for k in keys:
            out.extend(d.get(k) or [])
        return {"items": out[:MAX_ITEMS]}

    return attrs


def _local_midnight(day: str | None) -> datetime | None:
    if not day:
        return None
    try:
        d = date.fromisoformat(day[:10])
    except ValueError:
        return None
    return dt_util.start_of_local_day(d)


def _tonight_attrs(d: dict) -> dict[str, Any]:
    t = d.get("tonight") or {}
    return {
        "source": t.get("source"),
        "recipe_id": t.get("recipe_id"),
        "slot": t.get("slot"),
        "cooked": t.get("cooked"),
        "url": t.get("url"),
        "image_url": t.get("image_url"),
        "reasons": t.get("reasons") or [],
        "tomorrow": d.get("tomorrow") or [],
    }


def _party_attrs(d: dict) -> dict[str, Any]:
    p = d.get("party") or {}
    return {k: p.get(k) for k in ("name", "started_at", "ends_at", "open_orders", "new_orders", "orders_total", "guest_url") if k in p}


@dataclass(frozen=True, kw_only=True)
class ToHuusSensorDescription(SensorEntityDescription):
    """Describes a ToHuus Hub sensor."""

    value_fn: Callable[[dict], Any]
    attrs_fn: Callable[[dict], dict[str, Any]] | None = None
    picture_fn: Callable[[dict], str | None] | None = None


SENSORS: tuple[ToHuusSensorDescription, ...] = (
    ToHuusSensorDescription(
        key="products_low",
        translation_key="products_low",
        icon="mdi:package-variant",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_count("low"),
        attrs_fn=_items("low"),
    ),
    ToHuusSensorDescription(
        key="products_empty",
        translation_key="products_empty",
        icon="mdi:package-variant-remove",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_count("empty"),
        attrs_fn=_items("empty"),
    ),
    ToHuusSensorDescription(
        key="expiring_soon",
        translation_key="expiring_soon",
        icon="mdi:calendar-alert",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_count("expiring"),
        attrs_fn=_items("expiring"),
    ),
    ToHuusSensorDescription(
        key="shopping_list",
        translation_key="shopping_list",
        icon="mdi:cart-outline",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_count("shopping"),
        attrs_fn=lambda d: {"items": [s.get("summary") for s in (d.get("shopping") or [])][:50]},
    ),
    ToHuusSensorDescription(
        key="open_orders",
        translation_key="open_orders",
        icon="mdi:glass-cocktail",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_count("orders_open"),
        attrs_fn=lambda d: {"orders": (d.get("orders") or [])[:MAX_ITEMS], "new": (d.get("counts") or {}).get("orders_new", 0)},
    ),
    ToHuusSensorDescription(
        key="care_due",
        translation_key="care_due",
        icon="mdi:wrench-clock",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_count("care_due"),
        attrs_fn=lambda d: {"tasks": ((d.get("care") or {}).get("due") or [])[:MAX_ITEMS], "overdue": (d.get("counts") or {}).get("care_overdue", 0)},
    ),
    ToHuusSensorDescription(
        key="next_care_task",
        translation_key="next_care_task",
        device_class=SensorDeviceClass.TIMESTAMP,
        value_fn=lambda d: _local_midnight(((d.get("care") or {}).get("next") or {}).get("next_due")),
        attrs_fn=lambda d: {"task": ((d.get("care") or {}).get("next") or {}).get("name"), "task_id": ((d.get("care") or {}).get("next") or {}).get("id")},
    ),
    ToHuusSensorDescription(
        key="eat_first",
        translation_key="eat_first",
        icon="mdi:food-apple-outline",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_count("eat_first"),
        attrs_fn=lambda d: {"items": (d.get("eat_first") or [])[:MAX_ITEMS], "leftovers": (d.get("counts") or {}).get("leftovers", 0)},
    ),
    ToHuusSensorDescription(
        key="frozen_portions",
        translation_key="frozen_portions",
        icon="mdi:snowflake",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda d: (d.get("boxes") or {}).get("freezer_portions", 0),
        attrs_fn=lambda d: {
            "items": [b for b in ((d.get("boxes") or {}).get("items") or []) if b.get("place") == "freezer"][:MAX_ITEMS],
            "fridge_portions": (d.get("boxes") or {}).get("fridge_portions", 0),
            "thaw": (d.get("boxes") or {}).get("thaw") or [],
        },
    ),
    ToHuusSensorDescription(
        key="tonight",
        translation_key="tonight",
        icon="mdi:pot-steam-outline",
        value_fn=lambda d: ((d.get("tonight") or {}).get("title") or None),
        attrs_fn=_tonight_attrs,
        picture_fn=lambda d: (d.get("tonight") or {}).get("image_url"),
    ),
    ToHuusSensorDescription(
        key="party",
        translation_key="party",
        icon="mdi:party-popper",
        device_class=SensorDeviceClass.ENUM,
        options=["off", "live"],
        value_fn=lambda d: (d.get("party") or {}).get("status", "off"),
        attrs_fn=_party_attrs,
    ),
    ToHuusSensorDescription(
        key="kid_wishes",
        translation_key="kid_wishes",
        icon="mdi:human-child",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_count("kid_wishes"),
        attrs_fn=lambda d: {"wishes": (d.get("kid_wishes") or [])[:MAX_ITEMS]},
    ),
    ToHuusSensorDescription(
        key="receipts_to_review",
        translation_key="receipts_to_review",
        icon="mdi:receipt-text-check-outline",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_count("imports_to_review"),
    ),
)


async def async_setup_entry(hass: HomeAssistant, entry: ToHuusConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Sensors are always on – they are the core of the integration."""
    coordinator = entry.runtime_data.coordinator
    async_add_entities(ToHuusSensor(coordinator, d) for d in SENSORS)


class ToHuusSensor(ToHuusEntity, SensorEntity):
    """A sensor fed from the /state payload."""

    _platform_domain = "sensor"

    entity_description: ToHuusSensorDescription
    _unrecorded_attributes = LIST_ATTRS

    def __init__(self, coordinator: ToHuusCoordinator, description: ToHuusSensorDescription) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def native_value(self) -> Any:
        return self.entity_description.value_fn(self.data)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        fn = self.entity_description.attrs_fn
        return fn(self.data) if fn else None

    @property
    def entity_picture(self) -> str | None:
        fn = self.entity_description.picture_fn
        return fn(self.data) if fn else None

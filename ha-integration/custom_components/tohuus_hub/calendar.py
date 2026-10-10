"""Calendars: the meal plan and upcoming care tasks (all-day events)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .api import ToHuusError
from .const import DOMAIN, FEATURE_CALENDARS
from .coordinator import ToHuusConfigEntry, ToHuusCoordinator
from .entity import ToHuusEntity, feature_enabled


async def async_setup_entry(hass: HomeAssistant, entry: ToHuusConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Set up the calendars."""
    if feature_enabled(entry, FEATURE_CALENDARS):
        coordinator = entry.runtime_data.coordinator
        async_add_entities([MealPlanCalendar(coordinator), CareCalendar(coordinator)])


def _day(value: str) -> date:
    return date.fromisoformat(value[:10])


def _event(e: dict[str, Any]) -> CalendarEvent:
    start = _day(e["date"])
    return CalendarEvent(
        start=start,
        end=start + timedelta(days=1),
        summary=e.get("summary") or "",
        description=e.get("description") or None,
        uid=str(e.get("uid")),
    )


class _ToHuusCalendar(ToHuusEntity, CalendarEntity):
    _platform_domain = "calendar"

    async def _fetch(self, start: str, end: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    async def async_get_events(self, hass: HomeAssistant, start_date: datetime, end_date: datetime) -> list[CalendarEvent]:
        start = dt_util.as_local(start_date).date().isoformat()
        end = dt_util.as_local(end_date).date().isoformat()
        try:
            rows = await self._fetch(start, end)
        except ToHuusError as err:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="request_failed", translation_placeholders={"error": str(err)}) from err
        return [_event(r) for r in rows]


class MealPlanCalendar(_ToHuusCalendar):
    """What's planned for lunch and dinner."""

    _attr_translation_key = "meal_plan"

    def __init__(self, coordinator: ToHuusCoordinator) -> None:
        super().__init__(coordinator, "meal_plan")

    async def _fetch(self, start: str, end: str) -> list[dict[str, Any]]:
        return await self.coordinator.api.meal_events(start, end)

    @property
    def event(self) -> CalendarEvent | None:
        m = self.data.get("next_meal")
        if not m:
            return None
        return _event({"date": m["date"], "summary": m.get("title"), "uid": f"meal-{m.get('id')}", "description": None})

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        m = self.data.get("next_meal") or {}
        return {"recipe_id": m.get("recipe_id"), "slot": m.get("slot"), "image_url": m.get("image_url")} if m else None


class CareCalendar(_ToHuusCalendar):
    """Recurring household care: filters, smoke alarms, plants …"""

    _attr_translation_key = "care_tasks"

    def __init__(self, coordinator: ToHuusCoordinator) -> None:
        super().__init__(coordinator, "care_tasks")

    async def _fetch(self, start: str, end: str) -> list[dict[str, Any]]:
        return await self.coordinator.api.care_events(start, end)

    @property
    def event(self) -> CalendarEvent | None:
        nxt = (self.data.get("care") or {}).get("next")
        if not nxt or not nxt.get("next_due"):
            return None
        # an overdue task stays "today" until it's done
        due = max(nxt["next_due"], dt_util.now().date().isoformat())
        return _event({"date": due, "summary": nxt.get("name"), "uid": f"care-{nxt.get('id')}"})

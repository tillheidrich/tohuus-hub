"""The ToHuus Hub shopping list as a native Home Assistant to-do list (Assist, dashboards, voice)."""

from __future__ import annotations

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import ToHuusError
from .const import DOMAIN, FEATURE_TODO
from .coordinator import ToHuusConfigEntry, ToHuusCoordinator
from .entity import ToHuusEntity, feature_enabled


async def async_setup_entry(hass: HomeAssistant, entry: ToHuusConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Set up the shopping list to-do entity."""
    if feature_enabled(entry, FEATURE_TODO):
        async_add_entities([ToHuusShoppingList(entry.runtime_data.coordinator)])


class ToHuusShoppingList(ToHuusEntity, TodoListEntity):
    """Works directly against ToHuus Hub – no separate HA list to keep in sync."""

    _platform_domain = "todo"

    _attr_translation_key = "shopping_list"
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
        | TodoListEntityFeature.MOVE_TODO_ITEM
        | TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM
    )

    def __init__(self, coordinator: ToHuusCoordinator) -> None:
        super().__init__(coordinator, "shopping_list_todo")
        self.entity_id = "todo.tohuus_hub_shopping_list"

    @property
    def todo_items(self) -> list[TodoItem]:
        return [
            TodoItem(
                uid=str(i["uid"]),
                summary=i.get("summary") or "",
                status=TodoItemStatus.COMPLETED if i.get("status") == "completed" else TodoItemStatus.NEEDS_ACTION,
                description=i.get("description"),
            )
            for i in self.data.get("todo") or []
        ]

    async def _call(self, coro) -> None:
        try:
            await coro
        except ToHuusError as err:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="request_failed", translation_placeholders={"error": str(err)}) from err
        await self.coordinator.async_refresh()

    async def async_create_todo_item(self, item: TodoItem) -> None:
        await self._call(self.coordinator.api.todo_create(item.summary or "", item.description))

    async def async_update_todo_item(self, item: TodoItem) -> None:
        fields: dict = {"summary": item.summary, "description": item.description}
        if item.status is not None:
            fields["status"] = "completed" if item.status == TodoItemStatus.COMPLETED else "needs_action"
        await self._call(self.coordinator.api.todo_update(str(item.uid), **fields))

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        await self._call(self.coordinator.api.todo_delete([str(u) for u in uids]))

    async def async_move_todo_item(self, uid: str, previous_uid: str | None = None) -> None:
        await self._call(self.coordinator.api.todo_move(str(uid), previous_uid))

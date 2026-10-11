"""Services (actions): put things on the list, book stock, plan a meal, order from the sofa …"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv

from .api import ToHuusError, ToHuusRequestError
from .const import (
    ATTR_CONFIG_ENTRY_ID,
    DOMAIN,
    SERVICE_ADD_STOCK,
    SERVICE_ADD_TO_SHOPPING_LIST,
    SERVICE_APPROVE_KID_WISH,
    SERVICE_COMPLETE_CARE_TASK,
    SERVICE_CONSUME,
    SERVICE_MARK_USED_UP,
    SERVICE_ORDER,
    SERVICE_PLAN_MEAL,
    SERVICE_REPORT_PRESENCE,
)
from .coordinator import ToHuusConfigEntry

ATTR_TEXT = "text"
ATTR_PRODUCT = "product"
ATTR_QUANTITY = "quantity"
ATTR_BEST_BEFORE = "best_before"
ATTR_DATE = "date"
ATTR_RECIPE = "recipe"
ATTR_TITLE = "title"
ATTR_SLOT = "slot"
ATTR_ITEMS = "items"
ATTR_NOTE = "note"
ATTR_NAME = "name"
ATTR_WISH_ID = "wish_id"
ATTR_APPROVE = "approve"
ATTR_TASK = "task"
ATTR_EVERYONE_AWAY = "everyone_away"

# product: a name ("Milk"), an id (12) or "#12"
PRODUCT = vol.Any(cv.positive_int, cv.string)

BASE = {vol.Optional(ATTR_CONFIG_ENTRY_ID): cv.string}

SCHEMAS: dict[str, vol.Schema] = {
    SERVICE_ADD_TO_SHOPPING_LIST: vol.Schema(
        {
            **BASE,
            vol.Exclusive(ATTR_TEXT, "what"): cv.string,
            vol.Exclusive(ATTR_PRODUCT, "what"): PRODUCT,
            vol.Optional(ATTR_QUANTITY): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=999)),
        }
    ),
    SERVICE_CONSUME: vol.Schema({**BASE, vol.Required(ATTR_PRODUCT): PRODUCT, vol.Optional(ATTR_QUANTITY, default=1): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=999))}),
    SERVICE_MARK_USED_UP: vol.Schema({**BASE, vol.Required(ATTR_PRODUCT): PRODUCT}),
    SERVICE_ADD_STOCK: vol.Schema(
        {
            **BASE,
            vol.Required(ATTR_PRODUCT): PRODUCT,
            vol.Optional(ATTR_QUANTITY, default=1): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=999)),
            vol.Optional(ATTR_BEST_BEFORE): cv.date,
        }
    ),
    SERVICE_PLAN_MEAL: vol.Schema(
        {
            **BASE,
            vol.Exclusive(ATTR_RECIPE, "meal"): vol.Any(cv.positive_int, cv.string),
            vol.Exclusive(ATTR_TITLE, "meal"): cv.string,
            vol.Optional(ATTR_DATE): cv.date,
            vol.Optional(ATTR_SLOT, default="dinner"): vol.In(["lunch", "dinner"]),
        }
    ),
    SERVICE_ORDER: vol.Schema(
        {
            **BASE,
            vol.Optional(ATTR_PRODUCT): PRODUCT,
            vol.Optional(ATTR_QUANTITY, default=1): vol.All(vol.Coerce(int), vol.Range(min=1, max=20)),
            vol.Optional(ATTR_ITEMS): [vol.Schema({vol.Required(ATTR_PRODUCT): PRODUCT, vol.Optional("qty", default=1): vol.All(vol.Coerce(int), vol.Range(min=1, max=20)), vol.Optional("options", default=[]): [cv.string]})],
            vol.Optional(ATTR_NOTE): cv.string,
            vol.Optional(ATTR_NAME): cv.string,
        }
    ),
    SERVICE_APPROVE_KID_WISH: vol.Schema({**BASE, vol.Required(ATTR_WISH_ID): cv.positive_int, vol.Optional(ATTR_APPROVE, default=True): cv.boolean}),
    SERVICE_COMPLETE_CARE_TASK: vol.Schema({**BASE, vol.Required(ATTR_TASK): vol.Any(cv.positive_int, cv.string)}),
    SERVICE_REPORT_PRESENCE: vol.Schema({**BASE, vol.Required(ATTR_EVERYONE_AWAY): cv.boolean}),
}


def _entry(hass: HomeAssistant, call: ServiceCall) -> ToHuusConfigEntry:
    """The entry named in the call, or the only/first loaded one."""
    entries: list[ToHuusConfigEntry] = [e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED]
    wanted = call.data.get(ATTR_CONFIG_ENTRY_ID)
    if wanted:
        entries = [e for e in entries if e.entry_id == wanted]
    if not entries:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_entry")
    return entries[0]


def _payload(service: str, data: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Map the HA service fields onto the ToHuus Hub endpoint."""
    if service == SERVICE_ADD_TO_SHOPPING_LIST:
        if ATTR_TEXT not in data and ATTR_PRODUCT not in data:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="text_or_product")
        return "add_to_shopping_list", {"text": data.get(ATTR_TEXT), "product": data.get(ATTR_PRODUCT), "qty": data.get(ATTR_QUANTITY)}
    if service == SERVICE_CONSUME:
        return "consume", {"product": data[ATTR_PRODUCT], "qty": data[ATTR_QUANTITY]}
    if service == SERVICE_MARK_USED_UP:
        return "mark_used_up", {"product": data[ATTR_PRODUCT]}
    if service == SERVICE_ADD_STOCK:
        bb = data.get(ATTR_BEST_BEFORE)
        return "add_stock", {"product": data[ATTR_PRODUCT], "qty": data[ATTR_QUANTITY], "best_before": bb.isoformat() if bb else None}
    if service == SERVICE_PLAN_MEAL:
        if ATTR_RECIPE not in data and ATTR_TITLE not in data:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="recipe_or_title")
        day = data.get(ATTR_DATE)
        return "plan_meal", {"recipe": data.get(ATTR_RECIPE), "title": data.get(ATTR_TITLE), "day": day.isoformat() if day else None, "slot": data[ATTR_SLOT]}
    if service == SERVICE_ORDER:
        items = list(data.get(ATTR_ITEMS) or [])
        if ATTR_PRODUCT in data:
            items.append({"product": data[ATTR_PRODUCT], "qty": data[ATTR_QUANTITY], "options": []})
        if not items and not data.get(ATTR_NOTE):
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="order_empty")
        body: dict[str, Any] = {"items": items, "note": data.get(ATTR_NOTE)}
        if data.get(ATTR_NAME):
            body["name"] = data[ATTR_NAME]
        return "order", body
    if service == SERVICE_APPROVE_KID_WISH:
        return "approve_kid_wish", {"id": data[ATTR_WISH_ID], "approve": data[ATTR_APPROVE]}
    if service == SERVICE_COMPLETE_CARE_TASK:
        return "complete_care_task", {"task": data[ATTR_TASK]}
    if service == SERVICE_REPORT_PRESENCE:
        # away mode: only ever a suggestion in ToHuus Hub ("everyone away > 24 h – start away mode?")
        return "report_presence", {"everyone_away": data[ATTR_EVERYONE_AWAY]}
    raise ServiceValidationError(f"unknown service {service}")


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register all services (once, in async_setup)."""

    async def handle(call: ServiceCall) -> ServiceResponse:
        entry = _entry(hass, call)
        endpoint, body = _payload(call.service, dict(call.data))
        try:
            result = await entry.runtime_data.api.service(endpoint, body)
        except ToHuusRequestError as err:
            # e.g. "Product not found" – the user's input, not a broken connection
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="request_failed", translation_placeholders={"error": str(err)}) from err
        except ToHuusError as err:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="request_failed", translation_placeholders={"error": str(err)}) from err
        await entry.runtime_data.coordinator.async_request_refresh()
        if call.return_response:
            return result if isinstance(result, dict) else {"result": result}
        return None

    for name, schema in SCHEMAS.items():
        hass.services.async_register(DOMAIN, name, handle, schema=schema, supports_response=SupportsResponse.OPTIONAL)

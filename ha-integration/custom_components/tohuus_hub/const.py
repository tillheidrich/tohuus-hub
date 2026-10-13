"""Constants for the ToHuus Hub integration."""

from __future__ import annotations

from datetime import timedelta
from typing import Final

DOMAIN: Final = "tohuus_hub"
MANUFACTURER: Final = "ToHuus Hub"
API_VERSION: Final = 1
# keep in step with manifest.json
VERSION: Final = "0.3.1"

# ToHuus Cloud – Home Assistant pulls everything from here over HTTPS + server-sent events (no inbound connection)
CLOUD_URL: Final = "https://cloud.tohuus.heidrich-digital.de"
CONF_SERVER: Final = "server"
SERVER_CLOUD: Final = "cloud"
SERVER_OWN: Final = "own"
CONF_CODE: Final = "code"

CONF_FEATURES: Final = "features"
CONF_LIVE_UPDATES: Final = "live_updates"
CONF_DISPLAY_MODE: Final = "display_mode"
CONF_DISPLAY_WIDTH: Final = "display_width"
CONF_DISPLAY_HEIGHT: Final = "display_height"
CONF_COOKIDOO_SYNC: Final = "cookidoo_sync"
CONF_COOKIDOO_ENTITY: Final = "cookidoo_entity"
CONF_BRIDGE: Final = "bridge"
# ToHuus notifications → Home Assistant notify services (the integration listens to the event stream)
CONF_NOTIFY_SERVICES: Final = "notify_services"
CONF_NOTIFY_EVENTS: Final = "notify_events"

# Two-way bridge ("what Home Assistant already does"): safety-net interval, the rest is event-driven
BRIDGE_INTERVAL: Final = timedelta(minutes=5)
# fired after an NFC tag scan was forwarded to ToHuus Hub (result of its quick action)
EVENT_TAG_RESULT: Final = "tohuus_hub_tag"

# Cookidoo week plan → ToHuus Hub (the official Cookidoo integration's calendar)
DEFAULT_COOKIDOO_ENTITY: Final = "calendar.cookidoo_speiseplan"
COOKIDOO_INTERVAL: Final = timedelta(hours=3)
COOKIDOO_DAYS: Final = 14

FEATURE_TODO: Final = "todo"
FEATURE_CALENDARS: Final = "calendars"
FEATURE_DISPLAYS: Final = "displays"
FEATURE_BUTTONS: Final = "buttons"
FEATURE_EVENTS: Final = "events"
ALL_FEATURES: Final = [FEATURE_TODO, FEATURE_CALENDARS, FEATURE_DISPLAYS, FEATURE_BUTTONS, FEATURE_EVENTS]

DISPLAY_MODES: Final = ["color", "gray", "bw"]
DEFAULT_DISPLAY_MODE: Final = "color"
DEFAULT_DISPLAY_WIDTH: Final = 800
DEFAULT_DISPLAY_HEIGHT: Final = 480

SCAN_INTERVAL: Final = timedelta(seconds=60)

# Fired on the Home Assistant event bus for every ToHuus Hub notification
EVENT_TOHUUS: Final = "tohuus_hub_event"

# Notification events ToHuus Hub knows about (dotted on the wire, underscored for HA event entities)
EVENT_TYPES: Final = [
    "stock.low",
    "stock.empty",
    "stock.expiring",
    "import.review",
    "order.new",
    "order.status",
    "shopping.added",
    "digest.daily",
    "care.due",
    "party.ending",
    "kids.wish",
    "budget.warning",
    "plan.vote",
    "plan.rotation",
    "trip.started",
    "trip.addon",
    "rhythm.due",
    "plan.reminder",
    "test",
]

# who leads per topic (select entities); wire value ⇄ option shown in Home Assistant
LEADER_TOPICS: Final = ["shopping", "meals", "care"]
LEADER_OPTIONS: Final = {"two_way": "both", "from_ha": "home_assistant", "to_ha": "tohuus", "off": "off"}

# the same, underscored – option values of the "which notifications" selector (translation keys allow no dots)
NOTIFY_EVENT_OPTIONS: Final = [e.replace(".", "_") for e in EVENT_TYPES]

ATTR_CONFIG_ENTRY_ID: Final = "config_entry_id"

SERVICE_ADD_TO_SHOPPING_LIST: Final = "add_to_shopping_list"
SERVICE_CONSUME: Final = "consume"
SERVICE_MARK_USED_UP: Final = "mark_used_up"
SERVICE_ADD_STOCK: Final = "add_stock"
SERVICE_PLAN_MEAL: Final = "plan_meal"
SERVICE_ORDER: Final = "order"
SERVICE_APPROVE_KID_WISH: Final = "approve_kid_wish"
SERVICE_COMPLETE_CARE_TASK: Final = "complete_care_task"
SERVICE_REPORT_PRESENCE: Final = "report_presence"

"""Two-way bridge: "what Home Assistant already does" ⇄ ToHuus Hub.

ToHuus Hub decides per topic who leads (shopping list ⇄ HA to-do lists, meal plan ⇄ HA calendars, due care tasks →
an HA to-do list) and runs the sync engine. This module is the hands in Home Assistant:

- reports **capabilities** (to-do lists, calendars, people, notify services, voice-exposed devices) so ToHuus Hub
  can propose what to take over,
- sends **snapshots** of the entities ToHuus Hub watches (and people's states for "who is home"),
- runs the **operations** ToHuus Hub returns (add / update / remove to-do items, create / delete calendar events,
  notify through the companion app) and acknowledges them – a created item's uid completes the link,
- forwards **NFC tag scans** to ToHuus Hub quick actions.

Triggers: start-up, every few minutes, state changes of watched entities, and the `bridge` server-sent event that
ToHuus Hub sends after a local change. ToHuus Hub needs no Home Assistant token for any of this.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import date, datetime, timedelta
import logging
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.event import async_call_later, async_track_state_change_event, async_track_time_interval
from homeassistant.util import dt as dt_util

from .api import ToHuusApi, ToHuusError, ToHuusNotSupportedError
from .const import BRIDGE_INTERVAL, EVENT_TAG_RESULT, VERSION

_LOGGER = logging.getLogger(__name__)

VOICE_DOMAINS = ("light", "switch", "cover", "climate", "fan", "media_player", "scene", "script")
ASSISTANTS = {"assist": "conversation", "alexa": "cloud.alexa", "google": "cloud.google_assistant"}
MAX_ROUNDS = 3


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value) if value else None


class Bridge:
    """One bridge per config entry (one ToHuus Hub)."""

    def __init__(self, hass: HomeAssistant, api: ToHuusApi) -> None:
        self.hass = hass
        self.api = api
        self.config: dict[str, Any] = {"todo": [], "calendar": [], "persons": False, "tags": True, "want_capabilities": True}
        self.supported = True
        self.last_sync: datetime | None = None
        self.last_error: str | None = None
        self._acks: list[dict[str, Any]] = []
        self._lock = asyncio.Lock()
        self._unsubs: list[CALLBACK_TYPE] = []
        self._watch_unsub: CALLBACK_TYPE | None = None
        self._watched: tuple[str, ...] = ()
        self._pending: CALLBACK_TYPE | None = None

    # ------------------------------------------------------------------ lifecycle

    @callback
    def start(self) -> Callable[[], None]:
        """Initial sync, interval, tag scans; returns the stop callback."""
        self._unsubs.append(async_track_time_interval(self.hass, self._interval, BRIDGE_INTERVAL, name="tohuus_hub bridge"))
        self._unsubs.append(self.hass.bus.async_listen("tag_scanned", self._tag_scanned))
        self.hass.async_create_background_task(self.async_sync("start", capabilities=True), "tohuus_hub bridge start")
        return self.stop

    @callback
    def stop(self) -> None:
        """Unsubscribe everything."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        if self._watch_unsub:
            self._watch_unsub()
            self._watch_unsub = None
        if self._pending:
            self._pending()
            self._pending = None

    async def _interval(self, _now: datetime) -> None:
        await self.async_sync("interval")

    @callback
    def request_sync(self, reason: str = "event", capabilities: bool = False) -> None:
        """Debounced sync (server-sent `bridge` event, state changes)."""
        if not self.supported:
            return
        if self._pending:
            self._pending()

        @callback
        def _run(_now: datetime) -> None:
            self._pending = None
            self.hass.async_create_background_task(self.async_sync(reason, capabilities=capabilities), "tohuus_hub bridge sync")

        self._pending = async_call_later(self.hass, 1.5, _run)

    @callback
    def _rewatch(self) -> None:
        """Follow the entities ToHuus Hub asked for (plus people for presence)."""
        wanted = [*self.config.get("todo", []), *[c["entity_id"] for c in self.config.get("calendar", [])]]
        if self.config.get("persons"):
            wanted += self.hass.states.async_entity_ids("person")
        key = tuple(sorted(set(wanted)))
        if key == self._watched:
            return
        if self._watch_unsub:
            self._watch_unsub()
            self._watch_unsub = None
        self._watched = key
        if key:

            @callback
            def _changed(event: Event) -> None:
                new = event.data.get("new_state")
                if new is None or new.state == STATE_UNAVAILABLE:
                    return
                self.request_sync("state")

            self._watch_unsub = async_track_state_change_event(self.hass, list(key), _changed)

    # ------------------------------------------------------------------ one sync

    async def async_sync(self, reason: str = "manual", capabilities: bool = False) -> dict[str, Any] | None:
        """Up to three rounds: snapshot (+acks) → ToHuus Hub → run ops → send acks with a fresh snapshot."""
        if not self.supported:
            return None
        try:
            return await self._sync(capabilities)
        except HomeAssistantError as err:
            # e.g. a watched list's integration is not loaded right now – try again next time
            self.last_error = str(err)
            _LOGGER.debug("Bridge sync (%s) skipped: %s", reason, err)
        except Exception as err:  # noqa: BLE001 - a background sync must never take the integration down
            self.last_error = str(err) or err.__class__.__name__
            _LOGGER.exception("Unexpected error in the ToHuus Hub bridge (%s)", reason)
        return None

    async def _sync(self, capabilities: bool) -> dict[str, Any] | None:
        async with self._lock:
            result: dict[str, Any] | None = None
            for _round in range(MAX_ROUNDS):
                body: dict[str, Any] = {"version": VERSION, "acks": self._acks}
                if capabilities or self.config.get("want_capabilities"):
                    body["capabilities"] = self.capabilities()
                    capabilities = False
                body["todo"] = {e: await self.todo_snapshot(e) for e in self.config.get("todo", []) if self.hass.states.get(e)}
                body["calendar"] = {
                    c["entity_id"]: await self.calendar_snapshot(c["entity_id"], c.get("start"), c.get("end"))
                    for c in self.config.get("calendar", [])
                    if self.hass.states.get(c["entity_id"])
                }
                if self.config.get("persons"):
                    body["persons"] = self.persons()
                try:
                    result = await self.api.bridge_sync(body)
                except ToHuusNotSupportedError:
                    _LOGGER.info("This ToHuus Hub has no two-way bridge yet – update ToHuus Hub")
                    self.supported = False
                    return None
                except ToHuusError as err:
                    self.last_error = str(err)
                    _LOGGER.debug("Bridge sync failed: %s", err)
                    return None
                self._acks = []
                self.last_sync = dt_util.utcnow()
                self.last_error = None
                if isinstance(result.get("config"), dict):
                    self.config = result["config"]
                    self._rewatch()
                ops = result.get("ops") or []
                if not ops:
                    break
                self._acks = [await self.run_op(o) for o in ops]
            if self._acks:
                # rounds used up: deliver the last acknowledgements
                try:
                    await self.api.bridge_sync({"version": VERSION, "acks": self._acks})
                    self._acks = []
                except ToHuusError as err:
                    self.last_error = str(err)
            return result

    # ------------------------------------------------------------------ what HA has

    def capabilities(self) -> dict[str, Any]:
        """To-do lists, calendars, people, notify services and voice devices (with exposure per assistant)."""
        ent_reg = er.async_get(self.hass)
        dev_reg = dr.async_get(self.hass)
        area_reg = ar.async_get(self.hass)

        def meta(entity_id: str) -> tuple[str | None, str | None]:
            entry = ent_reg.async_get(entity_id)
            if entry is None:
                return None, None
            area_id = entry.area_id
            if not area_id and entry.device_id and (device := dev_reg.async_get(entry.device_id)):
                area_id = device.area_id
            area = area_reg.async_get_area(area_id) if area_id else None
            return entry.platform, area.name if area else None

        def name(state: Any) -> str:
            return str(state.attributes.get("friendly_name") or state.entity_id)

        todo, calendar = [], []
        for state in self.hass.states.async_all("todo"):
            platform, area = meta(state.entity_id)
            todo.append({"entity_id": state.entity_id, "name": name(state), "platform": platform, "area": area, "writable": bool(int(state.attributes.get("supported_features") or 0) & 1)})
        for state in self.hass.states.async_all("calendar"):
            platform, area = meta(state.entity_id)
            calendar.append({"entity_id": state.entity_id, "name": name(state), "platform": platform, "area": area, "writable": bool(int(state.attributes.get("supported_features") or 0) & 1)})

        should_expose: Callable[[str, str], bool] | None = None
        try:
            from homeassistant.components.homeassistant.exposed_entities import async_should_expose  # noqa: PLC0415

            def should_expose(assistant: str, entity_id: str) -> bool:
                try:
                    return bool(async_should_expose(self.hass, assistant, entity_id))
                except (KeyError, HomeAssistantError):
                    return False

        except ImportError:
            should_expose = None

        voice = []
        for state in self.hass.states.async_all(VOICE_DOMAINS):
            _platform, area = meta(state.entity_id)
            exposed = {k: should_expose(v, state.entity_id) for k, v in ASSISTANTS.items()} if should_expose else {}
            voice.append(
                {
                    "entity_id": state.entity_id,
                    "name": name(state),
                    "domain": state.domain,
                    "area": area,
                    "device_class": state.attributes.get("device_class"),
                    "exposed": exposed,
                }
            )
            if len(voice) >= 600:
                break
        return {
            "todo": todo,
            "calendar": calendar,
            "person": self.persons(),
            "notify": sorted(self.hass.services.async_services().get("notify", {}).keys()),
            "voice": voice,
            "tags": True,
        }

    def persons(self) -> list[dict[str, Any]]:
        """People and where they are (home / not_home / zone name)."""
        return [
            {"entity_id": s.entity_id, "name": str(s.attributes.get("friendly_name") or s.entity_id), "state": s.state, "user_id": s.attributes.get("user_id")}
            for s in self.hass.states.async_all("person")
        ]

    async def todo_snapshot(self, entity_id: str) -> dict[str, Any]:
        """All items of a to-do list (open and completed)."""
        items = await self._todo_items(entity_id)
        state = self.hass.states.get(entity_id)
        return {"items": items, "last_updated": _iso(state.last_updated) if state else None}

    async def _todo_items(self, entity_id: str) -> list[dict[str, Any]]:
        response = await self.hass.services.async_call(
            "todo", "get_items", {"entity_id": entity_id, "status": ["needs_action", "completed"]}, blocking=True, return_response=True
        )
        items = ((response or {}).get(entity_id) or {}).get("items") or []
        return [
            {"uid": i.get("uid"), "summary": i.get("summary") or "", "status": i.get("status"), "description": i.get("description")}
            for i in items
            if i.get("uid")
        ]

    async def calendar_snapshot(self, entity_id: str, start: str | None, end: str | None) -> dict[str, Any]:
        """Events in the range ToHuus Hub asked for – with uids when the calendar entity provides them."""
        tz = dt_util.get_default_time_zone()
        first = dt_util.parse_date(start or "") or dt_util.now().date()
        last = dt_util.parse_date(end or "") or (first + timedelta(days=14))
        start_dt = datetime.combine(first, datetime.min.time(), tz)
        end_dt = datetime.combine(last + timedelta(days=1), datetime.min.time(), tz)
        events: list[dict[str, Any]] = []
        entity = self._calendar_entity(entity_id)
        if entity is not None:
            for ev in await entity.async_get_events(self.hass, start_dt, end_dt):
                events.append({"uid": ev.uid, "summary": ev.summary or "", "description": ev.description, "start": _iso(ev.start)})
        else:
            response = await self.hass.services.async_call(
                "calendar", "get_events", {"entity_id": entity_id, "start_date_time": start_dt, "end_date_time": end_dt}, blocking=True, return_response=True
            )
            for ev in ((response or {}).get(entity_id) or {}).get("events") or []:
                events.append({"uid": None, "summary": ev.get("summary") or "", "description": ev.get("description"), "start": _iso(ev.get("start"))})
        state = self.hass.states.get(entity_id)
        return {"items": events, "last_updated": _iso(state.last_updated) if state else None}

    def _calendar_entity(self, entity_id: str) -> Any:
        component = self.hass.data.get("calendar")
        return component.get_entity(entity_id) if component is not None else None

    # ------------------------------------------------------------------ run ToHuus Hub's operations

    async def run_op(self, wrapped: dict[str, Any]) -> dict[str, Any]:
        """Run one operation; returns the acknowledgement (with the uid of a created to-do item)."""
        op_id = wrapped.get("id")
        op = wrapped.get("op") or {}
        try:
            uid = await self._run(op)
        except (HomeAssistantError, ValueError, KeyError, AttributeError, NotImplementedError) as err:
            _LOGGER.debug("Operation %s failed: %s", op, err)
            return {"id": op_id, "ok": False, "error": str(err) or err.__class__.__name__}
        return {"id": op_id, "ok": True, "uid": uid}

    async def _run(self, op: dict[str, Any]) -> str | None:
        kind = op.get("kind")
        if kind == "notify":
            service = str(op.get("service") or "").removeprefix("notify.")
            if not self.hass.services.has_service("notify", service):
                raise HomeAssistantError(f"notify.{service} not found")
            await self.hass.services.async_call("notify", service, {"title": op.get("title"), "message": op.get("message"), "data": op.get("data") or {}}, blocking=True)
            return None
        entity_id = str(op.get("entity_id") or "")
        if self.hass.states.get(entity_id) is None:
            # HA silently ignores service calls for unknown entities – ToHuus Hub should hear about it
            raise HomeAssistantError(f"{entity_id} not found")
        if kind == "todo":
            service = op.get("service")
            if service == "add_item":
                before = {i["uid"] for i in await self._todo_items(entity_id)}
                data: dict[str, Any] = {"entity_id": entity_id, "item": op.get("item")}
                if op.get("description"):
                    data["description"] = op["description"]
                await self.hass.services.async_call("todo", "add_item", data, blocking=True)
                after = await self._todo_items(entity_id)
                new = [i for i in after if i["uid"] not in before]
                hit = next((i for i in new if i["summary"] == op.get("item")), new[0] if new else None)
                return hit["uid"] if hit else None
            if service == "update_item":
                data = {"entity_id": entity_id, "item": op.get("uid")}
                if op.get("rename"):
                    data["rename"] = op["rename"]
                if op.get("status"):
                    data["status"] = op["status"]
                await self.hass.services.async_call("todo", "update_item", data, blocking=True)
                return None
            if service == "remove_item":
                await self.hass.services.async_call("todo", "remove_item", {"entity_id": entity_id, "item": op.get("uid")}, blocking=True)
                return None
        if kind == "calendar":
            if op.get("action") == "create":
                await self.hass.services.async_call(
                    "calendar",
                    "create_event",
                    {"entity_id": entity_id, "summary": op.get("summary"), "description": op.get("description") or "", "start_date": op.get("start_date"), "end_date": op.get("end_date")},
                    blocking=True,
                )
                return None
            if op.get("action") == "delete":
                entity = self._calendar_entity(entity_id)
                if entity is None:
                    raise HomeAssistantError(f"{entity_id} not found")
                await entity.async_delete_event(str(op.get("uid")))
                return None
        raise ValueError(f"unknown operation {kind}")

    # ------------------------------------------------------------------ NFC tags

    @callback
    def _tag_scanned(self, event: Event) -> None:
        if not self.supported or not self.config.get("tags", True):
            return
        self.hass.async_create_background_task(self.async_tag(event), "tohuus_hub tag")

    async def async_tag(self, event: Event) -> dict[str, Any] | None:
        """Forward a scan; ToHuus Hub runs the quick action mapped to this tag (if any)."""
        data = event.data
        tag_id = str(data.get("tag_id") or "")
        if not tag_id:
            return None
        device = None
        if device_id := data.get("device_id"):
            entry = dr.async_get(self.hass).async_get(device_id)
            device = (entry.name_by_user or entry.name) if entry else None
        user = None
        if event.context and event.context.user_id:
            u = await self.hass.auth.async_get_user(event.context.user_id)
            user = u.name if u else None
        try:
            result = await self.api.bridge_tag({"tag_id": tag_id, "name": data.get("name"), "device": device, "user": user})
        except ToHuusNotSupportedError:
            self.supported = False
            return None
        except ToHuusError as err:
            _LOGGER.debug("Tag forward failed: %s", err)
            return None
        # automations can speak / show the result ("Sparkling water: one less")
        self.hass.bus.async_fire(EVENT_TAG_RESULT, {"tag_id": tag_id, "ok": bool(result.get("ok")), "message": result.get("message")})
        return result

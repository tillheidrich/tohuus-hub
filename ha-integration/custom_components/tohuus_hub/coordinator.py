"""Data coordinator: polls /state every 60 s and refreshes instantly on server-sent change events."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import ToHuusApi, ToHuusAuthError, ToHuusError
from .const import ATTR_CONFIG_ENTRY_ID, CONF_LIVE_UPDATES, DOMAIN, EVENT_TOHUUS, SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)

# topics that cannot change anything the integration shows
IGNORED_TOPICS = {"settings"}


@dataclass
class ToHuusRuntimeData:
    """Stored on the config entry (entry.runtime_data)."""

    api: ToHuusApi
    coordinator: ToHuusCoordinator
    info: dict[str, Any] = field(default_factory=dict)


type ToHuusConfigEntry = ConfigEntry[ToHuusRuntimeData]


class ToHuusCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """One poll for everything; the event stream makes it near-instant."""

    config_entry: ToHuusConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ToHuusConfigEntry, api: ToHuusApi) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=SCAN_INTERVAL,
            # several changes in a row (checkout, import) → one refresh
            request_refresh_debouncer=Debouncer(hass, _LOGGER, cooldown=1.5, immediate=False),
        )
        self.api = api
        self._listener: asyncio.Task[None] | None = None
        self.live = False
        # event entities subscribe here to show the latest notification
        self.event_callbacks: set[Callable[[dict[str, Any]], None]] = set()

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            return await self.api.state()
        except ToHuusAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except ToHuusError as err:
            raise UpdateFailed(str(err)) from err

    # ------------------------------------------------------------ live updates

    @callback
    def start_listener(self) -> None:
        """Start the server-sent events listener (if enabled in the options)."""
        if not self.config_entry.options.get(CONF_LIVE_UPDATES, True) or self._listener:
            return
        self._listener = self.config_entry.async_create_background_task(self.hass, self._listen(), f"{DOMAIN}_events")

    @callback
    def stop_listener(self) -> None:
        """Stop the listener (unload)."""
        if self._listener:
            self._listener.cancel()
            self._listener = None
        self.live = False

    async def _listen(self) -> None:
        backoff = 5
        while True:
            try:
                async for event, data in self.api.events():
                    backoff = 5
                    if event == "hello":
                        self.live = True
                        # catch up on whatever happened while we were disconnected
                        await self.async_request_refresh()
                    elif event == "change":
                        topics = set(data.get("topics") or [])
                        if topics - IGNORED_TOPICS:
                            await self.async_request_refresh()
                    elif event == "tohuus":
                        self._fire(data)
            except asyncio.CancelledError:
                raise
            except ToHuusAuthError:
                _LOGGER.warning("ToHuus Hub rejected the token for live updates; falling back to polling")
                self.live = False
                return
            except ToHuusError as err:
                _LOGGER.debug("ToHuus Hub event stream closed: %s", err)
            except Exception:  # noqa: BLE001 - never let the listener die silently
                _LOGGER.exception("Unexpected error in the ToHuus Hub event stream")
            self.live = False
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 300)

    @callback
    def _fire(self, data: dict[str, Any]) -> None:
        """Put a ToHuus Hub notification on the HA event bus and on the event entity."""
        event = str(data.get("event") or "")
        payload = {
            "event": event,
            "type": event.replace(".", "_"),
            "title": data.get("title"),
            "message": data.get("message"),
            "url": data.get("url"),
            "data": data.get("data") or {},
            ATTR_CONFIG_ENTRY_ID: self.config_entry.entry_id,
        }
        self.hass.bus.async_fire(EVENT_TOHUUS, payload)
        for cb in list(self.event_callbacks):
            cb(payload)

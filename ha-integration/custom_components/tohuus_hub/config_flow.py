"""Config flow: ToHuus Cloud or own server, connected with a code from the ToHuus app (or a token). Options: features."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_TOKEN, CONF_URL, CONF_VERIFY_SSL
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import (
    ToHuusApi,
    ToHuusAuthError,
    ToHuusConnectionError,
    ToHuusError,
    ToHuusNotSupportedError,
    ToHuusPairError,
    async_claim_code,
    normalize_url,
)
from .const import (
    ALL_FEATURES,
    CLOUD_URL,
    CONF_BRIDGE,
    CONF_CODE,
    CONF_COOKIDOO_ENTITY,
    CONF_COOKIDOO_SYNC,
    CONF_DISPLAY_HEIGHT,
    CONF_DISPLAY_MODE,
    CONF_DISPLAY_WIDTH,
    CONF_FEATURES,
    CONF_LIVE_UPDATES,
    CONF_NOTIFY_EVENTS,
    CONF_NOTIFY_SERVICES,
    CONF_SERVER,
    DEFAULT_COOKIDOO_ENTITY,
    DEFAULT_DISPLAY_HEIGHT,
    DEFAULT_DISPLAY_MODE,
    DEFAULT_DISPLAY_WIDTH,
    DISPLAY_MODES,
    DOMAIN,
    NOTIFY_EVENT_OPTIONS,
    SERVER_CLOUD,
    SERVER_OWN,
)

CODE_SELECTOR = TextSelector(TextSelectorConfig(type=TextSelectorType.TEXT))
TOKEN_SELECTOR = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))
URL_SELECTOR = TextSelector(TextSelectorConfig(type=TextSelectorType.URL))


async def _validate(flow: ConfigFlow, url: str, token: str, verify_ssl: bool) -> tuple[dict[str, Any] | None, str | None]:
    """Return (info, error_key)."""
    api = ToHuusApi(async_get_clientsession(flow.hass, verify_ssl=verify_ssl), url, token)
    try:
        return await api.info(), None
    except ToHuusAuthError:
        return None, "invalid_auth"
    except ToHuusNotSupportedError:
        return None, "not_supported"
    except ToHuusConnectionError:
        return None, "cannot_connect"
    except ToHuusError:
        return None, "unknown"


async def _token_for(flow: ConfigFlow, url: str, code: str | None, token: str | None, verify_ssl: bool) -> tuple[str | None, str | None]:
    """A code from the app is exchanged for a token; a pasted token is used as is. Returns (token, error_key)."""
    code = (code or "").strip()
    token = (token or "").strip()
    if code:
        try:
            claimed = await async_claim_code(
                async_get_clientsession(flow.hass, verify_ssl=verify_ssl), url, code, flow.hass.config.location_name or "Home Assistant"
            )
        except ToHuusPairError as err:
            return None, {"invalid_code": "invalid_code", "too_many_attempts": "too_many_attempts", "gone": "invalid_code", "not_supported": "pairing_not_supported"}.get(err.reason, "invalid_code")
        except ToHuusConnectionError:
            return None, "cannot_connect"
        return claimed["token"], None
    if token:
        return token, None
    return None, "code_or_token"



URL_EXAMPLE = "http://192.168.1.20:8080"

class ToHuusConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for ToHuus Hub."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry) -> ToHuusOptionsFlow:
        """Options: features, live updates, display image, notifications."""
        return ToHuusOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """ToHuus Cloud or your own ToHuus Hub?"""
        return self.async_show_menu(step_id="user", menu_options=["cloud", "own_server"])

    async def _finish(self, url: str, token: str, verify_ssl: bool, server: str) -> tuple[ConfigFlowResult | None, str | None]:
        info, error = await _validate(self, url, token, verify_ssl)
        if error:
            return None, error
        assert info is not None
        await self.async_set_unique_id(info["instance_id"])
        self._abort_if_unique_id_configured(updates={CONF_URL: url, CONF_TOKEN: token})
        return (
            self.async_create_entry(
                title=info.get("household") or "ToHuus Hub",
                data={CONF_URL: url, CONF_TOKEN: token, CONF_VERIFY_SSL: verify_ssl, CONF_SERVER: server},
            ),
            None,
        )

    async def async_step_cloud(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """ToHuus Cloud: just the code from the app."""
        errors: dict[str, str] = {}
        if user_input is not None:
            token, error = await _token_for(self, CLOUD_URL, user_input.get(CONF_CODE), None, True)
            if token:
                result, error = await self._finish(CLOUD_URL, token, True, SERVER_CLOUD)
                if result:
                    return result
            errors["base"] = error or "unknown"
        return self.async_show_form(
            step_id="cloud",
            data_schema=vol.Schema({vol.Required(CONF_CODE): CODE_SELECTOR}),
            description_placeholders={"url": CLOUD_URL},
            errors=errors,
        )

    async def async_step_own_server(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Own server: address plus the code from the app (or a token from Access & AI)."""
        errors: dict[str, str] = {}
        if user_input is not None:
            url = normalize_url(user_input[CONF_URL])
            verify = user_input.get(CONF_VERIFY_SSL, True)
            token, error = await _token_for(self, url, user_input.get(CONF_CODE), user_input.get(CONF_TOKEN), verify)
            if token:
                result, error = await self._finish(url, token, verify, SERVER_OWN)
                if result:
                    return result
            errors["base"] = error or "unknown"
        defaults = user_input or {}
        return self.async_show_form(
            step_id="own_server",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_URL, default=defaults.get(CONF_URL, "")): URL_SELECTOR,
                    vol.Optional(CONF_CODE): CODE_SELECTOR,
                    vol.Optional(CONF_TOKEN): TOKEN_SELECTOR,
                    vol.Required(CONF_VERIFY_SSL, default=defaults.get(CONF_VERIFY_SSL, True)): bool,
                }
            ),
            # hassfest: no URLs inside strings.json – the example address comes in as a placeholder
            description_placeholders={"url_example": URL_EXAMPLE},
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        """The access was revoked or rotated."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Ask for a new code (or token)."""
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            verify = entry.data.get(CONF_VERIFY_SSL, True)
            token, error = await _token_for(self, entry.data[CONF_URL], user_input.get(CONF_CODE), user_input.get(CONF_TOKEN), verify)
            if token:
                info, error = await _validate(self, entry.data[CONF_URL], token, verify)
                if not error:
                    assert info is not None
                    await self.async_set_unique_id(info["instance_id"])
                    self._abort_if_unique_id_mismatch(reason="wrong_instance")
                    return self.async_update_reload_and_abort(entry, data_updates={CONF_TOKEN: token})
            errors["base"] = error or "unknown"
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Optional(CONF_CODE): CODE_SELECTOR, vol.Optional(CONF_TOKEN): TOKEN_SELECTOR}),
            description_placeholders={"url": entry.data[CONF_URL]},
            errors=errors,
        )

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Change the address (e.g. moved behind a reverse proxy, or from the own server to ToHuus Cloud)."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            url = normalize_url(user_input[CONF_URL])
            verify = user_input[CONF_VERIFY_SSL]
            token, error = await _token_for(self, url, user_input.get(CONF_CODE), user_input.get(CONF_TOKEN) or entry.data[CONF_TOKEN], verify)
            if token:
                info, error = await _validate(self, url, token, verify)
                if not error:
                    assert info is not None
                    await self.async_set_unique_id(info["instance_id"])
                    self._abort_if_unique_id_mismatch(reason="wrong_instance")
                    server = SERVER_CLOUD if url == CLOUD_URL else SERVER_OWN
                    return self.async_update_reload_and_abort(entry, data_updates={CONF_URL: url, CONF_TOKEN: token, CONF_VERIFY_SSL: verify, CONF_SERVER: server})
            errors["base"] = error or "unknown"
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_URL, default=entry.data[CONF_URL]): URL_SELECTOR,
                    vol.Optional(CONF_CODE): CODE_SELECTOR,
                    vol.Optional(CONF_TOKEN): TOKEN_SELECTOR,
                    vol.Required(CONF_VERIFY_SSL, default=entry.data.get(CONF_VERIFY_SSL, True)): bool,
                }
            ),
            description_placeholders={"cloud_url": CLOUD_URL, "url_example": URL_EXAMPLE},
            errors=errors,
        )


def notify_services(hass) -> list[str]:
    """Notify services that take a message (the entity-based send_message needs a target, so it is left out)."""
    return sorted(f"notify.{name}" for name in hass.services.async_services_for_domain("notify") if name != "send_message")


class ToHuusOptionsFlow(OptionsFlow):
    """Which parts of ToHuus Hub show up in Home Assistant."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Single options form."""
        if user_input is not None:
            return self.async_create_entry(
                data={
                    **user_input,
                    CONF_DISPLAY_WIDTH: int(user_input[CONF_DISPLAY_WIDTH]),
                    CONF_DISPLAY_HEIGHT: int(user_input[CONF_DISPLAY_HEIGHT]),
                    CONF_COOKIDOO_ENTITY: user_input.get(CONF_COOKIDOO_ENTITY) or "",
                }
            )
        o = self.config_entry.options
        cookidoo = o.get(CONF_COOKIDOO_ENTITY) or (DEFAULT_COOKIDOO_ENTITY if self.hass.states.get(DEFAULT_COOKIDOO_ENTITY) else None)
        size = NumberSelector(NumberSelectorConfig(min=100, max=2400, step=10, mode=NumberSelectorMode.BOX, unit_of_measurement="px"))
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_FEATURES, default=o.get(CONF_FEATURES, ALL_FEATURES)): SelectSelector(
                        SelectSelectorConfig(options=ALL_FEATURES, multiple=True, mode=SelectSelectorMode.LIST, translation_key="features")
                    ),
                    vol.Required(CONF_LIVE_UPDATES, default=o.get(CONF_LIVE_UPDATES, True)): bool,
                    vol.Required(CONF_DISPLAY_MODE, default=o.get(CONF_DISPLAY_MODE, DEFAULT_DISPLAY_MODE)): SelectSelector(
                        SelectSelectorConfig(options=DISPLAY_MODES, mode=SelectSelectorMode.DROPDOWN, translation_key="display_mode")
                    ),
                    vol.Required(CONF_DISPLAY_WIDTH, default=o.get(CONF_DISPLAY_WIDTH, DEFAULT_DISPLAY_WIDTH)): size,
                    vol.Required(CONF_DISPLAY_HEIGHT, default=o.get(CONF_DISPLAY_HEIGHT, DEFAULT_DISPLAY_HEIGHT)): size,
                    vol.Required(CONF_COOKIDOO_SYNC, default=o.get(CONF_COOKIDOO_SYNC, True)): bool,
                    vol.Optional(CONF_COOKIDOO_ENTITY, description={"suggested_value": cookidoo}): EntitySelector(EntitySelectorConfig(domain="calendar")),
                    vol.Required(CONF_BRIDGE, default=o.get(CONF_BRIDGE, True)): bool,
                    vol.Optional(CONF_NOTIFY_SERVICES, default=o.get(CONF_NOTIFY_SERVICES, [])): SelectSelector(
                        SelectSelectorConfig(options=notify_services(self.hass), multiple=True, custom_value=True, mode=SelectSelectorMode.DROPDOWN)
                    ),
                    vol.Optional(CONF_NOTIFY_EVENTS, default=o.get(CONF_NOTIFY_EVENTS, NOTIFY_EVENT_OPTIONS)): SelectSelector(
                        SelectSelectorConfig(options=NOTIFY_EVENT_OPTIONS, multiple=True, mode=SelectSelectorMode.LIST, translation_key="notify_events")
                    ),
                }
            ),
        )

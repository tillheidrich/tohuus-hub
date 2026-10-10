"""Config flow: ToHuus Hub address + a "Home Assistant" access token. Options: which features."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_TOKEN, CONF_URL, CONF_VERIFY_SSL
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
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

from .api import ToHuusApi, ToHuusAuthError, ToHuusConnectionError, ToHuusError, ToHuusNotSupportedError, normalize_url
from .const import (
    ALL_FEATURES,
    CONF_DISPLAY_HEIGHT,
    CONF_DISPLAY_MODE,
    CONF_DISPLAY_WIDTH,
    CONF_FEATURES,
    CONF_LIVE_UPDATES,
    DEFAULT_DISPLAY_HEIGHT,
    DEFAULT_DISPLAY_MODE,
    DEFAULT_DISPLAY_WIDTH,
    DISPLAY_MODES,
    DOMAIN,
)


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


class ToHuusConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for ToHuus Hub."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry) -> ToHuusOptionsFlow:
        """Options: features, live updates, display image."""
        return ToHuusOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Ask for the address and token."""
        errors: dict[str, str] = {}
        if user_input is not None:
            url = normalize_url(user_input[CONF_URL])
            info, error = await _validate(self, url, user_input[CONF_TOKEN].strip(), user_input[CONF_VERIFY_SSL])
            if error:
                errors["base"] = error
            else:
                assert info is not None
                await self.async_set_unique_id(info["instance_id"])
                self._abort_if_unique_id_configured(updates={CONF_URL: url, CONF_TOKEN: user_input[CONF_TOKEN].strip()})
                return self.async_create_entry(
                    title=info.get("household") or "ToHuus Hub",
                    data={CONF_URL: url, CONF_TOKEN: user_input[CONF_TOKEN].strip(), CONF_VERIFY_SSL: user_input[CONF_VERIFY_SSL]},
                )
        defaults = user_input or {}
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_URL, default=defaults.get(CONF_URL, "")): TextSelector(TextSelectorConfig(type=TextSelectorType.URL)),
                    vol.Required(CONF_TOKEN): TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD)),
                    vol.Required(CONF_VERIFY_SSL, default=defaults.get(CONF_VERIFY_SSL, True)): bool,
                }
            ),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        """The token was revoked or rotated."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Ask for a new token."""
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            token = user_input[CONF_TOKEN].strip()
            info, error = await _validate(self, entry.data[CONF_URL], token, entry.data.get(CONF_VERIFY_SSL, True))
            if error:
                errors["base"] = error
            else:
                assert info is not None
                await self.async_set_unique_id(info["instance_id"])
                self._abort_if_unique_id_mismatch(reason="wrong_instance")
                return self.async_update_reload_and_abort(entry, data_updates={CONF_TOKEN: token})
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_TOKEN): TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))}),
            description_placeholders={"url": entry.data[CONF_URL]},
            errors=errors,
        )

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Change the address (e.g. moved behind a reverse proxy)."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            url = normalize_url(user_input[CONF_URL])
            token = (user_input.get(CONF_TOKEN) or entry.data[CONF_TOKEN]).strip()
            info, error = await _validate(self, url, token, user_input[CONF_VERIFY_SSL])
            if error:
                errors["base"] = error
            else:
                assert info is not None
                await self.async_set_unique_id(info["instance_id"])
                self._abort_if_unique_id_mismatch(reason="wrong_instance")
                return self.async_update_reload_and_abort(entry, data_updates={CONF_URL: url, CONF_TOKEN: token, CONF_VERIFY_SSL: user_input[CONF_VERIFY_SSL]})
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_URL, default=entry.data[CONF_URL]): TextSelector(TextSelectorConfig(type=TextSelectorType.URL)),
                    vol.Optional(CONF_TOKEN): TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD)),
                    vol.Required(CONF_VERIFY_SSL, default=entry.data.get(CONF_VERIFY_SSL, True)): bool,
                }
            ),
            errors=errors,
        )


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
                }
            )
        o = self.config_entry.options
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
                }
            ),
        )

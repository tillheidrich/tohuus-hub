"""Base entity: one device "ToHuus Hub" per config entry."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_FEATURES, DOMAIN, MANUFACTURER
from .coordinator import ToHuusConfigEntry, ToHuusCoordinator


def feature_enabled(entry: ToHuusConfigEntry, feature: str) -> bool:
    """Features are on unless switched off in the options."""
    features = entry.options.get(CONF_FEATURES)
    return True if features is None else feature in features


def device_info(entry: ToHuusConfigEntry) -> DeviceInfo:
    """The ToHuus Hub instance as a service device."""
    info = entry.runtime_data.info
    return DeviceInfo(
        identifiers={(DOMAIN, entry.unique_id or entry.entry_id)},
        name=MANUFACTURER,
        model=info.get("household") or entry.title or MANUFACTURER,
        manufacturer=MANUFACTURER,
        sw_version=f"API v{info.get('api', 1)}",
        configuration_url=info.get("base_url") or entry.runtime_data.api.url,
        entry_type=DeviceEntryType.SERVICE,
    )


class ToHuusEntity(CoordinatorEntity[ToHuusCoordinator]):
    """Common base: has_entity_name, unique_id = entry + key, shared device."""

    _attr_has_entity_name = True
    # set by each platform class; gives language-independent entity ids (sensor.tohuus_hub_products_low …)
    # so the shipped dashboards work in every language. HA appends _2 for a second ToHuus Hub.
    _platform_domain: str = ""

    def __init__(self, coordinator: ToHuusCoordinator, key: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._attr_unique_id = f"{entry.unique_id or entry.entry_id}_{key}"
        self._attr_device_info = device_info(entry)
        self._key = key
        if self._platform_domain:
            self.entity_id = f"{self._platform_domain}.tohuus_hub_{key}"

    @property
    def data(self) -> dict:
        """Latest /state payload."""
        return self.coordinator.data or {}

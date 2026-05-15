from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, CONF_HOUSEHOLD_NAME
from .coordinator import KitcheyCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: KitcheyCoordinator = hass.data[DOMAIN][entry.entry_id]
    household = entry.data[CONF_HOUSEHOLD_NAME]
    async_add_entities([
        KitcheyExpiringSensor(coordinator, entry, household, days=3),
        KitcheyExpiringSensor(coordinator, entry, household, days=7),
        KitcheyShoppingSensor(coordinator, entry, household),
    ])


class KitcheyExpiringSensor(CoordinatorEntity, SensorEntity):
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "items"
    _attr_icon = "mdi:food-off"

    def __init__(self, coordinator: KitcheyCoordinator, entry: ConfigEntry, household: str, days: int) -> None:
        super().__init__(coordinator)
        self._days = days
        self._attr_unique_id = f"{entry.entry_id}_expiring_{days}d"
        self._attr_name = f"Kitchey {household} udløber inden {days} dage"

    @property
    def native_value(self) -> int:
        return len(self.coordinator.data.get(f"expiring_{self._days}d", []))

    @property
    def extra_state_attributes(self) -> dict:
        items = self.coordinator.data.get(f"expiring_{self._days}d", [])
        return {
            "items": [
                {
                    "id": i["id"],
                    "name": i.get("name"),
                    "expiry_date": i.get("expiry_date"),
                    "quantity": i.get("quantity"),
                    "location": i.get("location_name"),
                }
                for i in items
            ]
        }


class KitcheyShoppingSensor(CoordinatorEntity, SensorEntity):
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "items"
    _attr_icon = "mdi:cart"

    def __init__(self, coordinator: KitcheyCoordinator, entry: ConfigEntry, household: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_shopping"
        self._attr_name = f"Kitchey {household} indkøbsliste"

    @property
    def native_value(self) -> int:
        return len(self.coordinator.data.get("shopping", []))

    @property
    def extra_state_attributes(self) -> dict:
        return {
            "items": [
                {"id": i["id"], "name": i.get("product_name") or i.get("custom_name"), "quantity": i.get("quantity")}
                for i in self.coordinator.data.get("shopping", [])
            ]
        }

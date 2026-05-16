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

    entities: list[SensorEntity] = [
        KitcheyExpiringSensor(coordinator, entry, household, days=3),
        KitcheyExpiringSensor(coordinator, entry, household, days=7),
        KitcheyShoppingSensor(coordinator, entry, household),
        KitcheyCatalogSensor(coordinator, entry, household),
    ]

    known_unit_ids: set[str] = set()
    for unit in coordinator.data.get("storage_units", []):
        sensor = KitcheyStorageUnitSensor(coordinator, entry, household, unit)
        entities.append(sensor)
        known_unit_ids.add(unit["id"])

    async_add_entities(entities)

    def _add_new_unit_sensors() -> None:
        new_entities = []
        for unit in coordinator.data.get("storage_units", []):
            if unit["id"] not in known_unit_ids:
                known_unit_ids.add(unit["id"])
                new_entities.append(KitcheyStorageUnitSensor(coordinator, entry, household, unit))
        if new_entities:
            async_add_entities(new_entities)

    coordinator.async_add_listener(_add_new_unit_sensors)


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
                {
                    "id": i["id"],
                    "name": i.get("product_name") or i.get("custom_name"),
                    "quantity": i.get("quantity"),
                    "unit": i.get("unit"),
                }
                for i in self.coordinator.data.get("shopping", [])
            ]
        }


class KitcheyCatalogSensor(CoordinatorEntity, SensorEntity):
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "products"
    _attr_icon = "mdi:book-open-variant"

    def __init__(self, coordinator: KitcheyCoordinator, entry: ConfigEntry, household: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_catalog"
        self._attr_name = f"Kitchey {household} katalog"

    @property
    def native_value(self) -> int:
        return len(self.coordinator.data.get("catalog", []))

    @property
    def extra_state_attributes(self) -> dict:
        return {
            "products": [
                {
                    "id": p["id"],
                    "name": p.get("name"),
                    "unit": p.get("unit"),
                    "weight_per_unit": p.get("weight_per_unit"),
                    "brand": p.get("brand"),
                    "category": p.get("category"),
                    "in_stock": p.get("in_stock", 0),
                    "default_location_id": p.get("default_location_id"),
                    "default_location_name": p.get("default_location_name"),
                }
                for p in self.coordinator.data.get("catalog", [])
            ]
        }


class KitcheyStorageUnitSensor(CoordinatorEntity, SensorEntity):
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "items"

    _LIST_TYPE_ICONS = {
        "fridge": "mdi:fridge",
        "freezer": "mdi:snowflake",
        "pantry": "mdi:cupboard",
    }

    def __init__(
        self,
        coordinator: KitcheyCoordinator,
        entry: ConfigEntry,
        household: str,
        unit: dict,
    ) -> None:
        super().__init__(coordinator)
        self._unit_id = unit["id"]
        self._unit_name = unit["name"]
        self._list_type = unit.get("list_type", "")
        self._attr_unique_id = f"{entry.entry_id}_unit_{self._unit_id}"
        self._attr_name = f"Kitchey {household} {self._unit_name}"
        self._attr_icon = self._LIST_TYPE_ICONS.get(self._list_type, "mdi:package-variant")

    @property
    def native_value(self) -> int:
        return len(self._get_items())

    def _get_items(self) -> list:
        inventory = self.coordinator.data.get("inventory", [])
        return [i for i in inventory if i.get("storage_unit_id") == self._unit_id]

    def _get_locations(self) -> list:
        locations = self.coordinator.data.get("locations", [])
        return [
            {"id": loc["id"], "name": loc["name"]}
            for loc in locations
            if loc.get("storage_unit_id") == self._unit_id
        ]

    @property
    def extra_state_attributes(self) -> dict:
        items = self._get_items()
        today_str = str(__import__("datetime").date.today())
        expiring_3 = sum(
            1 for i in items
            if i.get("expiry_date") and i["expiry_date"][:10] >= today_str
            and (
                __import__("datetime").date.fromisoformat(i["expiry_date"][:10])
                - __import__("datetime").date.today()
            ).days <= 3
        )
        return {
            "unit_id": self._unit_id,
            "list_type": self._list_type,
            "expiring_3d": expiring_3,
            "locations": self._get_locations(),
            "items": [
                {
                    "id": i["id"],
                    "name": i.get("name"),
                    "quantity": i.get("quantity"),
                    "unit": i.get("unit"),
                    "weight_per_unit": i.get("weight_per_unit"),
                    "expiry_date": i.get("expiry_date", "")[:10] if i.get("expiry_date") else None,
                    "location_id": i.get("location_id"),
                    "location": i.get("location_name"),
                }
                for i in items
            ],
        }

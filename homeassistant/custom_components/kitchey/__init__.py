from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
import homeassistant.helpers.config_validation as cv

from .const import DOMAIN, CONF_SERVER_URL, CONF_TOKEN, CONF_HOUSEHOLD_ID
from .coordinator import KitcheyCoordinator

PLATFORMS = [Platform.SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = KitcheyCoordinator(
        hass,
        server_url=entry.data[CONF_SERVER_URL],
        token=entry.data[CONF_TOKEN],
        household_id=entry.data[CONF_HOUSEHOLD_ID],
    )
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    if not hass.services.has_service(DOMAIN, "add_to_shopping"):
        _register_services(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    if not hass.data.get(DOMAIN):
        for svc in (
            "add_to_shopping",
            "delete_shopping_item",
            "check_shopping_item",
            "use_item",
            "add_inventory_item",
            "create_storage_unit",
            "create_shelf",
        ):
            hass.services.async_remove(DOMAIN, svc)
    return unload_ok


def _register_services(hass: HomeAssistant) -> None:
    def _first_coordinator() -> KitcheyCoordinator | None:
        entries = hass.data.get(DOMAIN, {})
        return next(iter(entries.values()), None)

    async def handle_add_to_shopping(call: ServiceCall) -> None:
        c = _first_coordinator()
        if c is None:
            raise Exception("No Kitchey integration configured")
        await c.async_add_to_shopping(call.data["name"])

    async def handle_delete_shopping_item(call: ServiceCall) -> None:
        c = _first_coordinator()
        if c is None:
            raise Exception("No Kitchey integration configured")
        await c.async_delete_shopping_item(call.data["item_id"])

    async def handle_check_shopping_item(call: ServiceCall) -> None:
        c = _first_coordinator()
        if c is None:
            raise Exception("No Kitchey integration configured")
        await c.async_check_shopping_item(
            call.data["item_id"],
            call.data.get("checked_by", "Home Assistant"),
        )

    async def handle_use_item(call: ServiceCall) -> None:
        c = _first_coordinator()
        if c is None:
            raise Exception("No Kitchey integration configured")
        await c.async_use_item(call.data["item_id"], call.data.get("amount", 1))

    async def handle_add_inventory_item(call: ServiceCall) -> None:
        c = _first_coordinator()
        if c is None:
            raise Exception("No Kitchey integration configured")
        await c.async_add_inventory_item(
            call.data["product_id"],
            call.data.get("quantity", 1),
            call.data["list_type"],
            call.data.get("expiry_date"),
        )

    async def handle_create_storage_unit(call: ServiceCall) -> None:
        c = _first_coordinator()
        if c is None:
            raise Exception("No Kitchey integration configured")
        await c.async_create_storage_unit(
            call.data["name"],
            call.data["list_type"],
            call.data.get("icon", ""),
        )

    async def handle_create_shelf(call: ServiceCall) -> None:
        c = _first_coordinator()
        if c is None:
            raise Exception("No Kitchey integration configured")
        await c.async_create_shelf(call.data["name"], call.data["storage_unit_id"])

    hass.services.async_register(
        DOMAIN, "add_to_shopping",
        handle_add_to_shopping,
        schema=vol.Schema({vol.Required("name"): cv.string}),
    )
    hass.services.async_register(
        DOMAIN, "delete_shopping_item",
        handle_delete_shopping_item,
        schema=vol.Schema({vol.Required("item_id"): cv.string}),
    )
    hass.services.async_register(
        DOMAIN, "check_shopping_item",
        handle_check_shopping_item,
        schema=vol.Schema({
            vol.Required("item_id"): cv.string,
            vol.Optional("checked_by", default="Home Assistant"): cv.string,
        }),
    )
    hass.services.async_register(
        DOMAIN, "use_item",
        handle_use_item,
        schema=vol.Schema({
            vol.Required("item_id"): cv.string,
            vol.Optional("amount", default=1): cv.positive_int,
        }),
    )
    hass.services.async_register(
        DOMAIN, "add_inventory_item",
        handle_add_inventory_item,
        schema=vol.Schema({
            vol.Required("product_id"): cv.string,
            vol.Optional("quantity", default=1): cv.positive_int,
            vol.Required("list_type"): vol.In(["fridge", "freezer", "pantry"]),
            vol.Optional("expiry_date"): cv.string,
        }),
    )
    hass.services.async_register(
        DOMAIN, "create_storage_unit",
        handle_create_storage_unit,
        schema=vol.Schema({
            vol.Required("name"): cv.string,
            vol.Required("list_type"): vol.In(["fridge", "freezer", "pantry"]),
            vol.Optional("icon", default=""): cv.string,
        }),
    )
    hass.services.async_register(
        DOMAIN, "create_shelf",
        handle_create_shelf,
        schema=vol.Schema({
            vol.Required("name"): cv.string,
            vol.Required("storage_unit_id"): cv.string,
        }),
    )

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
    _register_services(hass, coordinator)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok


def _register_services(hass: HomeAssistant, coordinator: KitcheyCoordinator) -> None:
    async def handle_add_to_shopping(call: ServiceCall) -> None:
        await coordinator.async_add_to_shopping(call.data["name"])

    async def handle_use_item(call: ServiceCall) -> None:
        await coordinator.async_use_item(call.data["item_id"], call.data.get("amount", 1))

    hass.services.async_register(
        DOMAIN, "add_to_shopping",
        handle_add_to_shopping,
        schema=vol.Schema({vol.Required("name"): cv.string}),
    )
    hass.services.async_register(
        DOMAIN, "use_item",
        handle_use_item,
        schema=vol.Schema({
            vol.Required("item_id"): cv.positive_int,
            vol.Optional("amount", default=1): cv.positive_int,
        }),
    )

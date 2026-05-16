from __future__ import annotations

import json
import logging
import os
import shutil
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components import panel_custom
from homeassistant.components.http import HomeAssistantView
import homeassistant.helpers.config_validation as cv

from .const import DOMAIN, CONF_SERVER_URL, CONF_TOKEN, CONF_HOUSEHOLD_ID
from .coordinator import KitcheyCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]

_LOVELACE_CARDS = ["kitchey-storage-card", "kitchey-shopping-card", "kitchey-catalog-card"]

with open(os.path.join(os.path.dirname(__file__), "manifest.json")) as _f:
    _VERSION = json.load(_f).get("version", "1")


class KitcheyConfigView(HomeAssistantView):
    """Expose Kitchey credentials to the sidebar panel (HA-auth required)."""

    url = "/api/kitchey/config"
    name = "api:kitchey:config"
    requires_auth = True

    async def get(self, request):  # noqa: D102
        hass = request.app["hass"]
        entries = hass.data.get(DOMAIN, {})
        coordinator = next(iter(entries.values()), None)
        if coordinator is None:
            return self.json_message("Kitchey not configured", status_code=404)
        return self.json({
            "server_url":        coordinator.server_url,
            "token":             coordinator.token,
            "household_id":      coordinator.household_id,
            "is_official_server": coordinator.is_official_server,
        })


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Copy bundled JS files to www/kitchey/, register Lovelace cards and the sidebar panel."""
    src_lovelace = os.path.join(os.path.dirname(__file__), "lovelace")
    src_panel    = os.path.join(os.path.dirname(__file__), "panel", "kitchey-panel.js")
    dst_dir      = hass.config.path("www", "kitchey")
    os.makedirs(dst_dir, exist_ok=True)

    # Lovelace cards
    for card in _LOVELACE_CARDS:
        fname = f"{card}.js"
        src = os.path.join(src_lovelace, fname)
        dst = os.path.join(dst_dir, fname)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
            add_extra_js_url(hass, f"/local/kitchey/{fname}?v={_VERSION}")
            _LOGGER.debug("Registered Lovelace card: /local/kitchey/%s?v=%s", fname, _VERSION)
        else:
            _LOGGER.warning("Kitchey card not found: %s", src)

    # Sidebar panel
    if os.path.isfile(src_panel):
        shutil.copy2(src_panel, os.path.join(dst_dir, "kitchey-panel.js"))
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name="kitchey-panel",
            frontend_url_path="kitchey",
            sidebar_title="Kitchey",
            sidebar_icon="mdi:fridge-outline",
            module_url=f"/local/kitchey/kitchey-panel.js?v={_VERSION}",
            require_admin=False,
        )
        _LOGGER.debug("Registered Kitchey sidebar panel")
    else:
        _LOGGER.warning("Kitchey panel JS not found: %s", src_panel)

    # Config endpoint for the panel
    hass.http.register_view(KitcheyConfigView())

    return True


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
            "update_shopping_item",
            "delete_shopping_item",
            "check_shopping_item",
            "use_item",
            "add_inventory_item",
            "create_catalog_product",
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
        await c.async_add_to_shopping(
            call.data["name"],
            call.data.get("quantity", 1),
            call.data.get("unit", "stk"),
        )

    async def handle_delete_shopping_item(call: ServiceCall) -> None:
        c = _first_coordinator()
        if c is None:
            raise Exception("No Kitchey integration configured")
        await c.async_delete_shopping_item(call.data["item_id"])

    async def handle_update_shopping_item(call: ServiceCall) -> None:
        c = _first_coordinator()
        if c is None:
            raise Exception("No Kitchey integration configured")
        await c.async_update_shopping_item(
            call.data["item_id"],
            call.data["quantity"],
            call.data.get("unit", "stk"),
        )

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
            call.data.get("location_id"),
        )

    async def handle_create_catalog_product(call: ServiceCall) -> None:
        c = _first_coordinator()
        if c is None:
            raise Exception("No Kitchey integration configured")
        await c.async_create_catalog_product(
            call.data["name"],
            call.data.get("unit", "stk"),
            call.data.get("category", "pantry"),
            call.data.get("brand"),
            call.data.get("default_location_id"),
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
        schema=vol.Schema({
            vol.Required("name"): cv.string,
            vol.Optional("quantity", default=1): cv.positive_int,
            vol.Optional("unit", default="stk"): cv.string,
        }),
    )
    hass.services.async_register(
        DOMAIN, "update_shopping_item",
        handle_update_shopping_item,
        schema=vol.Schema({
            vol.Required("item_id"): cv.string,
            vol.Required("quantity"): cv.positive_int,
            vol.Optional("unit", default="stk"): cv.string,
        }),
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
            vol.Optional("location_id"): cv.string,
        }),
    )
    hass.services.async_register(
        DOMAIN, "create_catalog_product",
        handle_create_catalog_product,
        schema=vol.Schema({
            vol.Required("name"): cv.string,
            vol.Optional("unit", default="stk"): cv.string,
            vol.Optional("category", default="pantry"): vol.In(["fridge", "freezer", "pantry"]),
            vol.Optional("brand"): cv.string,
            vol.Optional("default_location_id"): cv.string,
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

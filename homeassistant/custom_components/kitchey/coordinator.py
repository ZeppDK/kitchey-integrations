from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, UPDATE_INTERVAL_MINUTES

_LOGGER = logging.getLogger(__name__)

OFFICIAL_SERVER = "kitchey.aihuset.dk"


class KitcheyCoordinator(DataUpdateCoordinator):
    def __init__(
        self,
        hass: HomeAssistant,
        server_url: str,
        token: str,
        household_id: str,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=UPDATE_INTERVAL_MINUTES),
        )
        self.server_url = server_url.rstrip("/")
        self.token = token
        self.household_id = household_id

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "X-Household-Id": self.household_id,
        }

    @property
    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    @property
    def is_official_server(self) -> bool:
        return OFFICIAL_SERVER in self.server_url

    async def _async_update_data(self) -> dict:
        session = async_get_clientsession(self.hass, verify_ssl=False)
        try:
            inventory, shopping, storage_units, locations = await _gather(
                self._fetch_json(session, f"{self.server_url}/api/inventory"),
                self._fetch_json(session, f"{self.server_url}/api/shopping"),
                self._fetch_json(session, f"{self.server_url}/api/storage-units"),
                self._fetch_json(session, f"{self.server_url}/api/locations"),
            )
        except Exception as err:
            raise UpdateFailed(f"Kitchey API error: {err}") from err

        # Build location_id → storage_unit_id mapping
        loc_to_unit: dict[str, str] = {
            loc["id"]: loc["storage_unit_id"]
            for loc in locations
            if loc.get("storage_unit_id")
        }

        # Enrich inventory items with storage_unit_id
        for item in inventory:
            loc_id = item.get("location_id")
            if loc_id and loc_id in loc_to_unit:
                item["storage_unit_id"] = loc_to_unit[loc_id]
            else:
                item.setdefault("storage_unit_id", None)

        today = date.today()

        def days_until(item: dict) -> int | None:
            raw = item.get("expiry_date")
            if not raw:
                return None
            try:
                return (datetime.fromisoformat(raw[:10]).date() - today).days
            except ValueError:
                return None

        expiring_3d = [i for i in inventory if (d := days_until(i)) is not None and 0 <= d <= 3]
        expiring_7d = [i for i in inventory if (d := days_until(i)) is not None and 0 <= d <= 7]

        return {
            "inventory": inventory,
            "expiring_3d": expiring_3d,
            "expiring_7d": expiring_7d,
            "shopping": [s for s in shopping if not s.get("checked")],
            "storage_units": storage_units,
        }

    async def _fetch_json(self, session, url: str) -> list:
        async with session.get(url, headers=self._headers) as resp:
            if resp.status == 401:
                raise UpdateFailed("Invalid PAT token — regenerate in Kitchey app settings")
            if resp.status != 200:
                raise UpdateFailed(f"API returned {resp.status} for {url}")
            return await resp.json()

    # ── Shopping services ──────────────────────────────────────────────────

    async def async_add_to_shopping(self, name: str, quantity: int = 1, unit: str = "stk") -> None:
        session = async_get_clientsession(self.hass, verify_ssl=False)
        async with session.post(
            f"{self.server_url}/api/shopping",
            headers=self._headers,
            json={"custom_name": name, "quantity": quantity, "unit": unit},
        ) as resp:
            if resp.status not in (200, 201):
                raise Exception(f"add_to_shopping failed: {resp.status}")
        await self.async_request_refresh()

    async def async_delete_shopping_item(self, item_id: str) -> None:
        session = async_get_clientsession(self.hass, verify_ssl=False)
        async with session.delete(
            f"{self.server_url}/api/shopping/{item_id}",
            headers=self._headers,
        ) as resp:
            if resp.status not in (200, 204):
                raise Exception(f"delete_shopping_item failed: {resp.status}")
        await self.async_request_refresh()

    async def async_check_shopping_item(self, item_id: str, checked_by: str = "Home Assistant") -> None:
        session = async_get_clientsession(self.hass, verify_ssl=False)
        async with session.put(
            f"{self.server_url}/api/shopping/{item_id}",
            headers=self._headers,
            json={"checked": True, "checked_by": checked_by},
        ) as resp:
            if resp.status != 200:
                raise Exception(f"check_shopping_item failed: {resp.status}")
        await self.async_request_refresh()

    # ── Inventory services ─────────────────────────────────────────────────

    async def async_use_item(self, item_id: str, amount: int = 1) -> None:
        session = async_get_clientsession(self.hass, verify_ssl=False)
        async with session.post(
            f"{self.server_url}/api/inventory/{item_id}/use",
            headers=self._headers,
            json={"amount": amount},
        ) as resp:
            if resp.status != 200:
                raise Exception(f"use_item failed: {resp.status}")
        await self.async_request_refresh()

    async def async_add_inventory_item(
        self,
        product_id: str,
        quantity: int,
        list_type: str,
        expiry_date: str | None,
    ) -> None:
        session = async_get_clientsession(self.hass, verify_ssl=False)
        payload: dict = {
            "product_id": product_id,
            "quantity": quantity,
            "list_type": list_type,
        }
        if expiry_date:
            payload["expiry_date"] = expiry_date
        async with session.post(
            f"{self.server_url}/api/inventory",
            headers=self._headers,
            json=payload,
        ) as resp:
            if resp.status not in (200, 201):
                raise Exception(f"add_inventory_item failed: {resp.status}")
        await self.async_request_refresh()

    # ── Creation services (premium-gated) ──────────────────────────────────

    async def _check_premium(self) -> bool:
        """Returns True if user is premium or on self-hosted server."""
        if not self.is_official_server:
            return True
        session = async_get_clientsession(self.hass, verify_ssl=False)
        async with session.get(
            f"{self.server_url}/api/premium/status",
            headers=self._auth_headers,
        ) as resp:
            if resp.status != 200:
                return False
            data = await resp.json()
            return bool(data.get("isPremium", False))

    async def async_create_storage_unit(self, name: str, list_type: str, icon: str = "") -> None:
        if not await self._check_premium():
            raise Exception(
                "Premium kræves for at oprette ekstra enheder på Kitchey cloud. "
                "Opgrader i appen, eller brug en self-hosted server."
            )
        session = async_get_clientsession(self.hass, verify_ssl=False)
        payload: dict = {"name": name, "list_type": list_type}
        if icon:
            payload["icon"] = icon
        async with session.post(
            f"{self.server_url}/api/storage-units",
            headers=self._headers,
            json=payload,
        ) as resp:
            if resp.status not in (200, 201):
                raise Exception(f"create_storage_unit failed: {resp.status}")
        await self.async_request_refresh()

    async def async_create_shelf(self, name: str, storage_unit_id: str) -> None:
        if not await self._check_premium():
            raise Exception(
                "Premium kræves for at oprette ekstra hylder på Kitchey cloud. "
                "Opgrader i appen, eller brug en self-hosted server."
            )
        session = async_get_clientsession(self.hass, verify_ssl=False)
        async with session.post(
            f"{self.server_url}/api/locations",
            headers=self._headers,
            json={"name": name, "storage_unit_id": storage_unit_id},
        ) as resp:
            if resp.status not in (200, 201):
                raise Exception(f"create_shelf failed: {resp.status}")
        await self.async_request_refresh()


async def _gather(*coros):
    """Run coroutines concurrently and return results in order."""
    import asyncio
    return await asyncio.gather(*coros)

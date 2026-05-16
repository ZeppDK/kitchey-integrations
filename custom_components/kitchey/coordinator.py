from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, UPDATE_INTERVAL_MINUTES

_LOGGER = logging.getLogger(__name__)


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

    async def _async_update_data(self) -> dict:
        session = async_get_clientsession(self.hass, verify_ssl=False)
        try:
            inventory = await self._fetch_json(session, f"{self.server_url}/api/inventory")
            shopping = await self._fetch_json(session, f"{self.server_url}/api/shopping")
        except Exception as err:
            raise UpdateFailed(f"Kitchey API error: {err}") from err

        today = date.today()

        def days_until(item: dict) -> int | None:
            raw = item.get("expiry_date")
            if not raw:
                return None
            try:
                return (datetime.fromisoformat(raw[:10]).date() - today).days
            except ValueError:
                return None

        expiring_3d = [i for i in inventory if (d := days_until(i)) is not None and d <= 3]
        expiring_7d = [i for i in inventory if (d := days_until(i)) is not None and d <= 7]

        return {
            "inventory": inventory,
            "expiring_3d": expiring_3d,
            "expiring_7d": expiring_7d,
            "shopping": [s for s in shopping if not s.get("checked")],
        }

    async def _fetch_json(self, session, url: str) -> list:
        async with session.get(url, headers=self._headers) as resp:
            if resp.status == 401:
                raise UpdateFailed("Invalid PAT token — regenerate in Kitchey app settings")
            if resp.status != 200:
                raise UpdateFailed(f"API returned {resp.status} for {url}")
            return await resp.json()

    async def async_add_to_shopping(self, name: str) -> None:
        session = async_get_clientsession(self.hass, verify_ssl=False)
        async with session.post(
            f"{self.server_url}/api/shopping",
            headers=self._headers,
            json={"custom_name": name, "quantity": 1, "unit": "stk"},
        ) as resp:
            if resp.status not in (200, 201):
                raise Exception(f"add_to_shopping failed: {resp.status}")
        await self.async_request_refresh()

    async def async_use_item(self, item_id: int, amount: int = 1) -> None:
        session = async_get_clientsession(self.hass, verify_ssl=False)
        async with session.post(
            f"{self.server_url}/api/inventory/{item_id}/use",
            headers=self._headers,
            json={"amount": amount},
        ) as resp:
            if resp.status != 200:
                raise Exception(f"use_item failed: {resp.status}")
        await self.async_request_refresh()

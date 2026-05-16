from __future__ import annotations

import voluptuous as vol
import aiohttp

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN, DEFAULT_SERVER, CONF_SERVER_URL, CONF_TOKEN, CONF_HOUSEHOLD_ID, CONF_HOUSEHOLD_NAME


class KitcheyConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._server_url: str = DEFAULT_SERVER
        self._token: str = ""
        self._households: list[dict] = []

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            self._server_url = user_input[CONF_SERVER_URL].rstrip("/")
            self._token = user_input[CONF_TOKEN].strip()

            households = await self._fetch_households()
            if households is None:
                errors["base"] = "cannot_connect"
            elif households == []:
                errors["base"] = "invalid_token"
            else:
                self._households = households
                return await self.async_step_household()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required(CONF_SERVER_URL, default=DEFAULT_SERVER): str,
                vol.Required(CONF_TOKEN): str,
            }),
            errors=errors,
        )

    async def async_step_household(self, user_input: dict | None = None) -> FlowResult:
        if user_input is not None:
            household_id = user_input[CONF_HOUSEHOLD_ID]
            household_name = next(
                (h["name"] for h in self._households if h["id"] == household_id),
                household_id,
            )
            await self.async_set_unique_id(f"{self._server_url}_{household_id}")
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=f"Kitchey - {household_name}",
                data={
                    CONF_SERVER_URL: self._server_url,
                    CONF_TOKEN: self._token,
                    CONF_HOUSEHOLD_ID: household_id,
                    CONF_HOUSEHOLD_NAME: household_name,
                },
            )

        options = {h["id"]: h["name"] for h in self._households}
        return self.async_show_form(
            step_id="household",
            data_schema=vol.Schema({
                vol.Required(CONF_HOUSEHOLD_ID): vol.In(options),
            }),
        )

    async def _fetch_households(self) -> list[dict] | None:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self._server_url}/api/households",
                    headers={"Authorization": f"Bearer {self._token}"},
                    ssl=False,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 401:
                        return []
                    if resp.status != 200:
                        return None
                    return await resp.json()
        except (aiohttp.ClientError, TimeoutError):
            return None

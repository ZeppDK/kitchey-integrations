from __future__ import annotations

import voluptuous as vol
import aiohttp

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN, DEFAULT_SERVER, CONF_SERVER_URL, CONF_TOKEN, CONF_HOUSEHOLD_ID, CONF_HOUSEHOLD_NAME
from .coordinator import OFFICIAL_SERVER


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

    async def async_step_reconfigure(self, user_input: dict | None = None) -> FlowResult:
        """Change server URL and/or token for an existing entry (Settings → Reconfigure)."""
        entry = self._get_reconfigure_entry()
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

        # On error, keep what the user typed instead of resetting to the stored values
        defaults = user_input or entry.data
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=vol.Schema({
                vol.Required(CONF_SERVER_URL, default=defaults[CONF_SERVER_URL]): str,
                vol.Required(CONF_TOKEN, default=defaults[CONF_TOKEN]): str,
            }),
            errors=errors,
        )

    async def async_step_household(self, user_input: dict | None = None) -> FlowResult:
        reconfiguring = self.source == config_entries.SOURCE_RECONFIGURE

        if user_input is not None:
            household_id = user_input[CONF_HOUSEHOLD_ID]
            household_name = next(
                (h["name"] for h in self._households if h["id"] == household_id),
                household_id,
            )
            unique_id = f"{self._server_url}_{household_id}"
            title = f"Kitchey - {household_name}"
            data = {
                CONF_SERVER_URL: self._server_url,
                CONF_TOKEN: self._token,
                CONF_HOUSEHOLD_ID: household_id,
                CONF_HOUSEHOLD_NAME: household_name,
            }

            if reconfiguring:
                entry = self._get_reconfigure_entry()
                for other in self._async_current_entries():
                    if other.entry_id != entry.entry_id and other.unique_id == unique_id:
                        return self.async_abort(reason="already_configured")
                return self.async_update_reload_and_abort(
                    entry, unique_id=unique_id, title=title, data=data
                )

            await self.async_set_unique_id(unique_id)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(title=title, data=data)

        options = {h["id"]: h["name"] for h in self._households}
        current = self._get_reconfigure_entry().data[CONF_HOUSEHOLD_ID] if reconfiguring else None
        return self.async_show_form(
            step_id="household",
            data_schema=vol.Schema({
                vol.Required(
                    CONF_HOUSEHOLD_ID,
                    **({"default": current} if current in options else {}),
                ): vol.In(options),
            }),
        )

    async def _fetch_households(self) -> list[dict] | None:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self._server_url}/api/households",
                    headers={"Authorization": f"Bearer {self._token}"},
                    ssl=(OFFICIAL_SERVER in self._server_url),
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 401:
                        return []
                    if resp.status != 200:
                        return None
                    return await resp.json()
        except (aiohttp.ClientError, TimeoutError):
            return None

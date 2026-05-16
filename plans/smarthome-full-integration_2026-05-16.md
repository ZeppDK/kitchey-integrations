# Plan · Smarthome Full Integration

## Brief
Kitchey's Home Assistant and Homey integrations currently expose 3 sensors and 2 services each with 30-minute polling. The goal is full parity with the app's 5 main areas (Fryser, Køleskab, Kolonial, Indkøb, Katalog) via sensors, services, devices, and dashboard cards, with premium-gated creation features and 10-minute polling plus immediate refresh after mutations.

## Stack
- Home Assistant custom component - Python 3.11, HA 2023.1+
- Homey App SDK v3 - Node.js
- Kitchey REST API - existing endpoints (inventory, shopping, catalog, storage-units, locations, premium)
- HA Lovelace custom card - JavaScript/Lit, separate npm package in `lovelace/` folder
- HACS - distribution for both HA component and Lovelace card

## Scope

**Phase 1 - Poll interval + extended sensors/actions (no new deps)**
- Poll interval changed from 30 min to 10 min in both integrations
- Homey: `_poll()` called immediately after every action (add, use, delete, check)
- HA coordinator fetches storage-units and catalog in addition to inventory + shopping
- HA new sensors per storage unit (one sensor per unit, state = item count, attributes = full item list with name, qty, expiry, location)
- HA new services: `delete_shopping_item` (item_id), `check_shopping_item` (item_id, checked_by), `add_inventory_item` (product_id, quantity, list_type, expiry_date)
- Homey new flow actions: `delete_shopping_item`, `check_shopping_item`, `add_inventory_item`
- Homey new flow trigger: `item_expires_today` (fires day-of)

**Phase 2 - Homey devices**
- Each storage unit becomes a Homey Device (class `StorageUnitDevice`)
- Capabilities per device: `measure_item_count` (integer), `measure_expiring_3d` (integer), `measure_expiring_7d` (integer)
- Device settings: storage_unit_id, list_type, name
- Device card shows stats like the TVOC example (count, expiring soon)
- `ShoppingDevice` with capabilities: `measure_shopping_count` (integer), action capability: `add_to_shopping`
- Devices auto-created/removed when storage units are added/removed in the app
- `StorageUnitDriver` + `ShoppingDriver` added to `app.json` with correct capability definitions

**Phase 3 - Premium-gated creation + self-host bypass**
- HA services: `create_storage_unit` (name, list_type, icon), `create_shelf` (name, storage_unit_id)
- Homey flow actions: `create_storage_unit`, `create_shelf`
- Both call `GET /api/premium/status` before creation - if `is_premium: false` AND server is official (`kitchey.aihuset.dk`), return error with upgrade message
- Self-hosted (any other server URL) bypasses premium check entirely
- Same free limits enforced: max 1 unit per list_type, max 4 locations per unit

**Phase 4 - HA Lovelace dashboard card**
- New folder `lovelace/` at repo root - standalone npm project
- Card 1: `kitchey-storage-card` - displays one storage unit's items as a scrollable list with name, qty, expiry badge (green/yellow/red), location
- Card 2: `kitchey-shopping-card` - displays unchecked shopping items, inline text input to add custom item, tap item to check it off
- Both cards registered in `hacs.json` as separate plugin entry
- Cards built to single `.js` file each, no bundler required at install time (pre-built included in repo)

## Out of Scope
- Catalog editing from smarthome (read-only catalog queries only)
- Barcode scanning from smarthome
- Push notification configuration via smarthome
- User/household management (invite codes, member roles)
- Consumption log / statistics display
- Native Android/iOS app changes
- Homey Insights timeline support (can be added later via `this.homey.insights`)
- Multi-household support within a single integration instance

## Constraints
- No breaking changes to existing sensors or services - only additive
- HA component stays within `custom_components/kitchey/` - no extra install steps
- Homey devices must work without requiring re-pairing when polling interval changes
- All new services fire `async_request_refresh()` / `_poll()` immediately after API call
- Premium check uses server URL comparison, not a hardcoded list - self-hosted always passes
- `custom_components/kitchey/` (HACS root copy) must stay in sync with `homeassistant/custom_components/kitchey/` after every change

## Definition of Done
All four phases are committed to `master` in `kitchey-integrations`: poll interval is 10 min in both integrations, HA exposes one sensor per storage unit plus delete/check/add-inventory services, Homey exposes StorageUnitDevice and ShoppingDevice with correct capabilities visible in the Homey app, premium-gated creation services exist in both integrations, and both Lovelace cards load in HA without errors and render item lists from live sensor data.

## Acceptance Criteria
- `const.py` has `UPDATE_INTERVAL_MINUTES = 10`, Homey `app.js` has `10 * 60 * 1000`
- HA coordinator calls `/api/storage-units` and `/api/inventory` and `/api/shopping` each poll
- HA registers one `KitcheyStorageUnitSensor` per storage unit returned by API (dynamic, not hardcoded)
- HA `delete_shopping_item` and `check_shopping_item` services exist and call correct endpoints
- Homey `StorageUnitDevice` class exists with `measure_item_count`, `measure_expiring_3d`, `measure_expiring_7d` capabilities
- Homey `ShoppingDevice` exists with `measure_shopping_count` capability
- `create_storage_unit` service in HA returns 403-equivalent error with upgrade message when called on official server without premium
- `create_storage_unit` service succeeds without premium check when server URL is not `kitchey.aihuset.dk`
- `lovelace/kitchey-storage-card.js` and `lovelace/kitchey-shopping-card.js` exist as pre-built files
- Both Lovelace cards render without console errors when added to a HA dashboard with a valid entity

## Verification
1. Grep for `UPDATE_INTERVAL_MINUTES` in both const.py files - confirm value is 10
2. Grep for `10 * 60 * 1000` in `homey/app.js`
3. In HA dev tools → Services: confirm `kitchey.delete_shopping_item`, `kitchey.check_shopping_item`, `kitchey.add_inventory_item`, `kitchey.create_storage_unit`, `kitchey.create_shelf` all appear
4. In HA dev tools → States: confirm sensors like `sensor.kitchey_*_fryser`, `sensor.kitchey_*_køleskab` etc. appear alongside existing sensors
5. In Homey app → Devices: confirm StorageUnit and Shopping devices appear with capability values
6. Call `create_storage_unit` via HA service on official server without premium - confirm error returned
7. Open HA dashboard with `kitchey-storage-card` and `kitchey-shopping-card` - confirm items render, no console errors

## Turn Budget
Stop after 80 turns, or sooner once the DoD condition holds.

## References
- Current HA component: `homeassistant/custom_components/kitchey/`
- Current Homey app: `homey/`
- HACS root copy (must stay in sync): `custom_components/kitchey/`
- Kitchey API endpoints: `docs/api.md`
- Server premium route: `GET /api/premium/status` (returns `{ is_premium: bool, plan: str }`)
- Homey SDK v3 Device docs: https://apps.developer.homey.app/the-basics/devices
- Homey capabilities reference: https://apps.developer.homey.app/the-basics/devices/capabilities
- HA custom component sensor docs: https://developers.home-assistant.io/docs/core/entity/sensor
- Lovelace custom card docs: https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card

## Risks / Open Questions
- Homey device auto-creation: SDK v3 requires drivers to be declared in `app.json` at install time - dynamic device creation is done via `driver.createDevice()` but the driver itself must exist statically. Two drivers needed: `StorageUnitDriver` and `ShoppingDriver`.
- HA dynamic sensors: `async_add_entities` is called once at setup. If storage units change later, sensors won't auto-add without implementing `ConfigEntry` reload or a coordinator listener that adds new entities. Simplest approach: reload entry on poll if unit count changes.
- Lovelace card distribution: HACS supports both integrations and plugins (frontend) in the same repo via `hacs.json`. Needs `"frontend"` category entry. Verify HACS plugin detection works before finalizing.
- Premium endpoint: `/api/premium/status` needs to be verified against prod server - confirm it returns `is_premium` field. If it doesn't exist yet, Phase 3 is blocked.
- `item_id` in `use_item` service is currently typed as `cv.positive_int` but IDs are UUIDs in PostgreSQL - this is a pre-existing bug that needs fixing in Phase 1.

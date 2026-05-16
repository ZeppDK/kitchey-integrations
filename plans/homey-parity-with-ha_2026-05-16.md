# Plan · Homey parity with Home Assistant integration

## Brief
The Homey app currently has only minimal functionality (2 triggers, 2 flow actions, no devices).
The goal is to bring it to full parity with the Home Assistant integration: devices per storage unit, shopping list device, all CRUD flow actions, premium gating, and the missing triggers.

## Stack
- Homey SDK 3 (Node.js ≥18)
- Homey app source at `homey/.homeybuild/` (app.js, api.js, app.json - no separate src dir)
- Kitchey REST API (same endpoints used by HA coordinator)
- No new npm dependencies

## Scope

- **api.js** - add missing methods: `getStorageUnits`, `getCatalog`, `getLocations`, `deleteShoppingItem`, `checkShoppingItem`, `updateShoppingItem`, `addInventoryItem`, `createCatalogProduct`, `createStorageUnit`, `createShelf`, `checkPremium`
- **Devices - StorageUnit driver** - one Homey device per storage unit, capabilities: `items_on_stock` (number), `expiring_3d` (number), `expiring_7d` (number); device card shows all three stats; poll updates capabilities
- **Devices - ShoppingList driver** - one Homey device for the shopping list, capability: `shopping_count` (number of unchecked items); poll updates it
- **Poll** - extend `_poll()` to fetch storage units + inventory per unit to drive device capabilities; keep existing expiry/shopping trigger logic intact
- **Flow trigger** - add `item_expires_today` (fires on expiry day, tokens: item_name, quantity)
- **Flow actions** - add all missing actions:
  - `remove_shopping_item` - autocomplete from shopping list, calls DELETE /api/shopping/:id
  - `check_shopping_item` - autocomplete from shopping list, calls PUT /api/shopping/:id {checked:true}
  - `add_inventory_item` - autocomplete product from catalog + list_type + quantity + optional expiry_date
  - `create_catalog_product` - name + unit + category + optional brand
  - `create_storage_unit` - name + list_type; premium gated
  - `create_shelf` - name + autocomplete storage unit; premium gated
- **add_to_shopping improvement** - add `quantity` (number, default 1) and `unit` (text, default stk) fields
- **Premium gating** - `checkPremium()`: returns true if server URL ≠ `kitchey.aihuset.dk`, else calls `GET /api/premium/status` → `isPremium`; throw descriptive error in create_storage_unit / create_shelf if not premium

## Out of Scope
- Homey App Store submission / publishing (manual step by user)
- Dashboard / web UI widgets (Homey doesn't support Lovelace-style cards)
- Catalog browsing UI - catalog data only used as autocomplete source for add_inventory_item
- Homey timeline notifications beyond existing flow triggers
- Any changes to the HA integration

## Constraints
- Source files are in `homey/.homeybuild/` - do not create a parallel src directory
- No new npm dependencies - use only Node.js built-ins + the already-bundled `homey` devDep
- Match existing code style (CommonJS `require`, single-file drivers inline in app.js if Homey SDK 3 allows, else create `drivers/` under `.homeybuild/`)
- Device IDs must be stable - use `unit.id` (UUID from API) as Homey device ID so re-pairing isn't needed on re-install
- Premium gating must silently pass for self-hosted servers (any URL that isn't `kitchey.aihuset.dk`)
- Both EN and DA titles required in app.json for all new flow cards and device capabilities

## Definition of Done
All files in `homey/.homeybuild/` are updated such that `homey app validate` exits 0 and the feature checklist in Acceptance Criteria is fully satisfied as verified by code inspection.

## Acceptance Criteria
- `api.js` exports methods for all 11 new API calls listed in Scope
- `app.json` declares `StorageUnit` and `ShoppingList` drivers with correct capability IDs
- `app.json` declares `item_expires_today` trigger with `item_name` and `quantity` tokens
- `app.json` declares all 6 new action cards (remove_shopping_item, check_shopping_item, add_inventory_item, create_catalog_product, create_storage_unit, create_shelf)
- `add_to_shopping` action in `app.json` has `quantity` and `unit` args
- `app.js` `_poll()` fetches storage units and updates device capabilities (`items_on_stock`, `expiring_3d`, `expiring_7d`)
- `app.js` `_poll()` updates ShoppingList device capability (`shopping_count`)
- `create_storage_unit` and `create_shelf` action handlers call `checkPremium()` and throw a user-facing error when not premium on the official server
- All new flow action run listeners call the matching api.js method and throw on non-2xx status
- All new autocomplete listeners (shopping items, catalog products, storage units) return `id` + `name` + `description` shaped objects

## Verification
1. Read `homey/.homeybuild/app.json` - confirm all new flow card IDs are present in `triggers` and `actions`
2. Read `homey/.homeybuild/api.js` - confirm each new method exists and uses the correct HTTP verb + path
3. Read `homey/.homeybuild/app.js` - confirm driver classes or inline device handling exist for StorageUnit and ShoppingList
4. Grep for `create_storage_unit` and `create_shelf` run listeners - confirm `checkPremium()` call before API call
5. Grep for `item_expires_today` - confirm trigger is registered and fired correctly in `_checkExpiry`

## Turn Budget
Stop after 50 turns, or sooner once the DoD condition holds.

## References
- HA integration source of truth: `homeassistant/custom_components/kitchey/`
  - `coordinator.py` - all API methods and their signatures
  - `sensor.py` - what data surfaces per device type
  - `__init__.py` - full service/action list
- Current Homey source: `homey/.homeybuild/app.js`, `api.js`, `app.json`
- README Homey section: describes target device + flow card surface

## Risks / Open Questions
- **Homey SDK 3 drivers** - SDK 3 requires drivers to live in `drivers/<id>/device.js` + `driver.js` + `driver.compose.json`. The current app has no `drivers/` directory. The agent must create this structure under `.homeybuild/drivers/`.
- **Pairing approach: auto-pairing via pair-wizard** - StorageUnit driver uses `onPair` to fetch `GET /api/storage-units` and list them for the user to select. ShoppingList driver always has exactly one device (the household's list), so the wizard just creates it immediately with no selection step. Both drivers use `Homey.Device` subclass with `onAdded` / `onDeleted` lifecycle. Capabilities are updated by `app.js` after each poll by iterating `driver.getDevices()`.
- **Shopping item DELETE endpoint** - `docs/api.md` shows `PUT /api/shopping/:id` for check-off but does not document a DELETE. The HA coordinator uses `DELETE /api/shopping/:id`. Use the same pattern as HA and handle 404 gracefully.
- **`add_to_shopping` arg change** - Adding `quantity` and `unit` to an existing action card is a breaking change for users who have the old card in flows. Acceptable since app is not yet published widely.

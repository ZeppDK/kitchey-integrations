# Kitchey Integrations

Connect your [Kitchey](https://aihuset.dk/kitchey) fridge inventory to Home Assistant and Homey.

## What you can do

- **Sidebar panel** — full Kitchey Command Center pinned to the HA sidebar: browse and edit inventory, manage your shopping list, search the catalog, and configure storage units and shelves — all without leaving Home Assistant
- See items expiring within 3 or 7 days as sensors
- See your shopping list item count as a sensor
- See stock counts per storage unit as sensors
- Browse your product catalog with stock levels and category filter
- Add, update and remove shopping list items via automations or dashboard cards
- Mark items as used via automations
- Manage inventory via automations

## Authentication

All integrations use a **Personal Access Token (PAT)**. Generate one in the Kitchey app:

> Settings → Advanced → API Keys → Create

Tokens look like `ft_live_...` and give the same access as your account.

## Server URL

By default both integrations connect to `https://kitchey.aihuset.dk`.

If you self-host Kitchey, enter your own URL instead (e.g. `http://192.168.1.10:3035`). See the [Kitchey repo](https://github.com/ZeppDK/freshtrack) for self-hosting instructions.

---

## Home Assistant

### Install via HACS

1. HACS → Integrations → ⋮ → Custom repositories
2. Add `https://github.com/ZeppDK/kitchey-integrations` as type **Integration**
3. Search for "Kitchey" and install
4. Restart Home Assistant

<details>
<summary>Manual install (without HACS)</summary>

Copy `custom_components/kitchey/` into your HA `config/custom_components/` folder and restart.

</details>

### Setup

1. Settings → Devices & Services → Add Integration → search "Kitchey"
2. Enter server URL and PAT token
3. Select your household
4. Done — sensors, dashboard cards, and the sidebar panel are ready immediately

To change the server URL, token or household later: Settings → Devices & Services → Kitchey → ⋮ → **Reconfigure** (no need to delete and re-add).

### Sidebar Panel

After setup a **Kitchey** entry appears in the HA sidebar (fridge icon). It opens a full management panel with four tabs:

- **Lager** — browse inventory grouped by storage unit and shelf, edit quantity/expiry/location/notes, add items via catalog search or barcode scanner (HID keyboard wedge supported)
- **Indkøb** — shopping list with inline add, tap-to-check, quantity edit, and clear checked
- **Katalog** — full product catalog with stock levels and category filter
- **Indstillinger** — household info, storage units and shelves (create/delete, premium-gated on cloud), dietary preferences, profile name

### Sensors

| Entity | Description |
|--------|-------------|
| `sensor.kitchey_<household>_udlober_inden_3_dage` | Items expiring within 3 days |
| `sensor.kitchey_<household>_udlober_inden_7_dage` | Items expiring within 7 days |
| `sensor.kitchey_<household>_indkobsliste` | Unchecked shopping list items |
| `sensor.kitchey_<household>_katalog` | Number of catalog products |
| `sensor.kitchey_<household>_<unit>` | One sensor per storage unit (Fryser, Køleskab, etc.) |

**Storage unit sensor attributes** include: `items` (full list with id, name, quantity, unit, weight\_per\_unit, expiry\_date, location\_id, location), `locations` (available shelves with id and name), `expiring_3d`, `unit_id`, `list_type`.

**Catalog sensor attributes** include: `products` list with id, name, unit, weight\_per\_unit, brand, category, in\_stock, default\_location\_id, default\_location\_name.

Sensors update every **10 minutes** and immediately after any service call.

### Services

| Service | Fields | Description |
|---------|--------|-------------|
| `kitchey.add_to_shopping` | `name`, `quantity` (default 1), `unit` (default stk) | Add item to shopping list |
| `kitchey.update_shopping_item` | `item_id` (UUID), `quantity`, `unit` (default stk) | Update quantity/unit of a shopping item |
| `kitchey.delete_shopping_item` | `item_id` (UUID) | Remove item from shopping list |
| `kitchey.check_shopping_item` | `item_id` (UUID), `checked_by` (optional) | Mark shopping item as found |
| `kitchey.use_item` | `item_id` (UUID), `amount` (default 1) | Decrement inventory item |
| `kitchey.add_inventory_item` | `product_id` (UUID), `list_type`, `quantity`, `expiry_date` (optional), `location_id` (optional) | Add catalog product to inventory, optionally on a specific shelf |
| `kitchey.create_catalog_product` | `name`, `unit` (default stk), `category`, `brand` (optional), `default_location_id` (optional) | Create new product in catalog |
| `kitchey.create_storage_unit` | `name`, `list_type` (fridge/freezer/pantry), `icon` (optional) | Create new storage unit — premium required on cloud |
| `kitchey.create_shelf` | `name`, `storage_unit_id` (UUID) | Create shelf in a storage unit — premium required on cloud |

> **Finding IDs:** Product IDs are in the catalog sensor's `products` attribute. Location (shelf) IDs are in each storage unit sensor's `locations` attribute. Item IDs are in the `items` attribute of each sensor.

### Lovelace Dashboard Cards

Three dashboard cards are **bundled with the integration** and load automatically — no extra installation needed.

Add them to your dashboard via the YAML editor:

**kitchey-storage-card** — shows all items in a storage unit with quantity, total volume/weight, per-unit size, and expiry colour badges:
```yaml
type: custom:kitchey-storage-card
entity: sensor.kitchey_<household>_<unit>
title: Køleskab      # optional
max_items: 15        # optional, default 20
```

**kitchey-shopping-card** — shopping list with tap-to-check, inline add, and quantity edit:
```yaml
type: custom:kitchey-shopping-card
entity: sensor.kitchey_<household>_indkobsliste
```

**kitchey-catalog-card** — full product catalog with stock levels, category filter (fridge/freezer/pantry), and search:
```yaml
type: custom:kitchey-catalog-card
entity: sensor.kitchey_<household>_katalog
title: Katalog       # optional
```

> **Tip:** Find the exact entity IDs under Settings → Devices & Services → Kitchey → Entities.

---

## Homey

> **Not yet in the Homey App Store.** Until the app is published, install it by sideloading it with the Homey CLI. Requires a Homey Pro and Node.js 18+.

### Install (sideload)

```bash
npm install -g homey
homey login
cd homey
npm install
homey app install
```

`homey app install` installs the app permanently on your Homey Pro. Use `homey app run` instead for a development session with live logs.

### Setup

1. Open the Kitchey app's settings in the Homey app
2. Enter your **Server URL** (default: `https://kitchey.aihuset.dk`) and a **Personal Access Token** (`ft_live_...`)
3. Press **Test connection and load households**, pick your household in the dropdown and **Save**
4. Go to **Devices → Add → Kitchey** to add your devices

### Devices

- **Household overview** — items in stock, expiring within 3 / 7 days, expired, open shopping items, expired items alarm, next to expire, latest added, expired items (names), expiring within 7 days (names)
- **Storage unit** — one device per storage unit, with items in stock, expiring within 3 / 7 days, expired, expired items alarm, next to expire, latest added, expired items (names) and expiring within 7 days (names)
- **Shopping list** — open shopping items, the shopping list as text, and one capability per open item (max 15)

Numbers and alarms are logged to Homey Insights. Data updates every **5 minutes** and immediately after any Flow action. All cards and device texts are also available in Danish.

### Flow cards

**Triggers**
- An item expires within X days
- An item expires today
- An item has expired
- An item was added to stock
- An item was removed from stock
- An item was added to the shopping list
- A shopping item was checked off
- A shopping item was removed
- The shopping list is complete
- Shopping list grows above X items

**Conditions**
- A product is / isn't in stock
- An item is / isn't on the shopping list
- There are / are no expired items
- Items are / aren't expiring within X days
- Shopping list has / doesn't have more than X open items

**Actions**
- Add an item to the shopping list
- Check off a shopping item
- Check off a shopping item by name
- Remove a shopping item
- Remove a shopping item by name
- Clear checked shopping items
- Get the shopping list as text
- Mark an item as used
- Mark an item as used by name
- Set the quantity of an item
- Remove an item from stock
- Add a catalog product to stock
- Add an item to stock by name
- Get the stock of a product
- Get expiring items as text
- Create a catalog product
- Create a storage unit
- Create a shelf in a storage unit
- Refresh data from Kitchey now

**Device cards**

The cards above are app cards and live under **Apps → Kitchey** in the Flow editor. Device cards appear when you pick a Storage unit device or the Shopping list device directly.

On a Storage unit device:
- Add a catalog product to this storage unit
- Add an item to this storage unit by name
- Mark an item in this storage unit as used
- Remove an item from this storage unit
- Get expiring items in this storage unit as text

On the Shopping list device:
- Add an item to this shopping list
- Check off an item on this shopping list
- Check off an item on this shopping list by name
- Remove an item from this shopping list
- Remove an item from this shopping list by name
- Clear checked items on this shopping list

See [homey/README.md](homey/README.md) for arguments, tokens, dashboards, example Flows, self-hosting and troubleshooting.

---

## API reference

See [docs/api.md](docs/api.md) for the full REST API used by both integrations.

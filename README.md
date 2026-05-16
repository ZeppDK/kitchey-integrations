# Kitchey Integrations

Connect your [Kitchey](https://aihuset.dk/kitchey) fridge inventory to Home Assistant and Homey.

## What you can do

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
4. Done — sensors and dashboard cards are ready immediately

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

### Install via Homey App Store

Install directly from the [Homey App Store](https://homey.app/en-us/app/dk.kitchey.homey/) — no compilation needed.

<details>
<summary>Developer install (compile from source)</summary>

```bash
cd homey
npm install
homey app install
```

</details>

### Setup

1. Open the Kitchey app in Homey
2. Go to app settings and enter:
   - **Server URL** (default: `https://kitchey.aihuset.dk`)
   - **Personal Access Token** (`ft_live_...`)
   - **Household ID** (shown in the Kitchey app under Settings → Advanced)
3. Save — the app polls immediately

### Devices

Each storage unit (Fryser, Køleskab, Kolonial, etc.) appears as a device in Homey with three stats visible on its card:
- **Items on stock** — total item count
- **Expiring ≤3 days** — items expiring within 3 days
- **Expiring ≤7 days** — items expiring within 7 days

A **Shopping List** device shows the count of unchecked items.

Devices update every **10 minutes** and immediately after any flow action.

### Flow cards

**Triggers**
- *An item expires within X days* — fires once per item per day, tokens: item name, expiry date, quantity
- *An item expires today* — fires on the expiry day, tokens: item name, quantity
- *Shopping list has more than X items*

**Actions**
- *Add [name] to shopping list*
- *Remove [item] from shopping list*
- *Mark [item] as found* — checks off a shopping item
- *Mark [item] as used ([amount]×)* — decrements inventory
- *Add [product] to inventory* — adds from catalog with quantity
- *Create storage unit [name] ([type])* — premium required on cloud
- *Create shelf [name] in [unit]* — premium required on cloud

---

## API reference

See [docs/api.md](docs/api.md) for the full REST API used by both integrations.

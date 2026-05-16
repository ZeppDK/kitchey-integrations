# Kitchey Integrations

Connect your [Kitchey](https://aihuset.dk/kitchey) fridge inventory to Home Assistant and Homey.

## What you can do

- See items expiring within 3 or 7 days as sensors
- See your shopping list item count as a sensor
- Add items to the shopping list via automations
- Mark items as used via automations

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

Copy `homeassistant/custom_components/kitchey/` into your HA `config/custom_components/` folder and restart.

</details>

### Setup

1. Settings → Devices & Services → Add Integration → search "Kitchey"
2. Enter server URL and PAT token
3. Select your household
4. Done — sensors appear immediately

### Sensors

| Entity | Description |
|--------|-------------|
| `sensor.kitchey_<household>_udløber_inden_3_dage` | Items expiring within 3 days |
| `sensor.kitchey_<household>_udløber_inden_7_dage` | Items expiring within 7 days |
| `sensor.kitchey_<household>_indkøbsliste` | Unchecked shopping list items |

Sensor attributes include the full item list (name, expiry date, quantity, location).

### Services

| Service | Fields | Description |
|---------|--------|-------------|
| `kitchey.add_to_shopping` | `name` (string) | Add item to shopping list |
| `kitchey.use_item` | `item_id` (int), `amount` (int, default 1) | Decrement inventory item |

Item IDs are found in the sensor's attribute list.

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

### Flow cards

**Triggers**
- *An item expires within X days* — fires once per item per day, with tokens: item name, expiry date, quantity
- *Shopping list has more than X items*

**Actions**
- *Add [name] to shopping list*
- *Mark item [id] as used ([amount]×)*

---

## API reference

See [docs/api.md](docs/api.md) for the full REST API used by both integrations.

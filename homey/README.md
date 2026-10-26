# Kitchey for Homey

See what is in your fridge, freezer and pantry, get expiry warnings and manage the shared shopping list from [Homey](https://homey.app). The app connects to your [Kitchey](https://aihuset.dk/kitchey) household (cloud or self-hosted), exposes your storage units and shopping list as Homey devices, and adds Flow cards for expiry alerts, stock checks and shopping-list automation.

App id: `dk.kitchey.homey` (Homey SDK 3, Homey Pro). All Flow cards, capabilities and device texts are also localized in Danish, and follow the language of your Homey.

## Installation

The app is published in the Homey App Store **Test channel**. Install it from the test link, which works on any Homey Pro and needs no developer tools:

**https://homey.app/a/dk.kitchey.homey/test/**

Open the link, sign in with your Homey account, pick your Homey and press *Install*. Updates are not automatic on the Test channel: when a new build is released to Test, open the link again and install it.

Once the app has been certified by Athom it will be listed publicly in the Homey App Store and update automatically.

<details>
<summary>Alternative: sideload from source with the Homey CLI</summary>

Requires a Homey Pro and Node.js 18+ on the computer you install from.

```bash
npm install -g homey
homey login
cd homey
npm install
homey app install
```

`homey app install` installs the app permanently on your Homey Pro. For a development session with live logs, use `homey app run` instead (the app is removed again when you stop the session).

</details>

## Setup

1. In the Homey app, open the Kitchey app's settings.
2. Enter the **Server URL** — the default is `https://kitchey.aihuset.dk`; use your own URL if you [self-host](#self-hosting).
3. Enter a **Personal Access Token**. Create one in the Kitchey app under **Settings → Advanced → API access keys**. Tokens look like `ft_live_...` and give the same access as your account.
4. Press **Test connection and load households**. Your households are loaded into a dropdown.
5. Pick the **household** and press **Save settings**. The app polls Kitchey immediately.
6. Add devices: **Devices → Add → Kitchey**.

> **Tip:** If you prefer, you can paste a household ID into the household field manually instead of using the dropdown.

The status block at the bottom of the settings page shows the time of the last update, the number of items and expired items, open shopping items, your storage units, and the last error (if any).

## Devices

Add devices via the pair wizard (**Devices → Add → Kitchey**). Items are mapped to storage units through their shelf (location); items without a shelf are shown under the first storage unit of the same type (fridge/freezer/pantry).

| Device | Added | Capabilities |
|--------|-------|--------------|
| **Household overview** | Once | Items in stock\*, Expiring within 3 days\*, Expiring within 7 days\*, Expired\*, Open shopping items\*, Expired items alarm\*, Next to expire, Latest added, Expired items, Expiring within 7 days (text) |
| **Storage unit** | One per storage unit (fridge, freezer, pantry, …) | Items in stock\*, Expiring within 3 days\*, Expiring within 7 days\*, Expired\*, Expired items alarm\*, Next to expire, Latest added, Expired items, Expiring within 7 days (text) |
| **Shopping list** | Once | Open shopping items\*, Shopping list, plus one **Item** capability per open item (see below) |

\* Logged to **Homey Insights** (numbers and the alarm). The text capabilities (Next to expire, Latest added, Expired items, Expiring within 7 days (text), Shopping list, Item) are not logged.

- **Items in stock** — number of inventory items.
- **Expiring within 3 days / 7 days** — number of items with an expiry date within the window (today included).
- **Expired** — number of items past their expiry date.
- **Expired items alarm** — on while at least one item is expired. Insights show it as "Expired items in stock" / "No expired items".
- **Next to expire** — text such as `Milk · 01-11 (tomorrow)` (day-month) for the not-yet-expired item that expires first.
- **Latest added** — text such as `Cheese (1 pcs)` for the most recently added item.
- **Expired items** — text with the names of the expired items (up to 5, then `(+n)` for the rest).
- **Expiring within 7 days (text)** — text with the names of the items expiring within 7 days and the relative day, e.g. `Chicken breast (6 days)` (up to 5, then `(+n)` for the rest). This text capability is separate from the numeric *Expiring within 7 days* count.
- **Open shopping items** — number of unchecked shopping-list items.
- **Shopping list** — text with the names of the first 6 open items (`Milk, Coffee, … (+3)` when there are more).

**Per-item capabilities on the Shopping list device:** the device also gets one sub-capability (`shopping_item.0`, `shopping_item.1`, …) for each open item, up to a maximum of **15**. The capability title is the item name and its value is the quantity and unit (e.g. `2 l`), so the whole list can be read on the device card. They are added and removed automatically as the list changes.

## Dashboards

Use the devices on **Homey Dashboards** like any other device:

- **Sensor tiles** for the number capabilities (Items in stock, Expiring within 3/7 days, Expired, Open shopping items).
- **Text tiles** for **Next to expire**, **Latest added**, **Expired items** and **Expiring within 7 days** (text) (storage unit and household devices) and **Shopping list** (shopping device). Add the Shopping list device as a whole to see every open item with its quantity.
- **Status tile** for **Expired items alarm** — a quick red/green indicator for each storage unit or the whole household.
- **Insights graphs** for the counts over time, e.g. open shopping items per week or the number of items expiring within 7 days.

## Flow cards

All cards are available in English and Danish. Storage unit arguments marked *autocomplete* are searched as you type; the "Storage unit" argument on the condition/text cards also offers "Whole household".

### Triggers

| Card | Arguments | Tokens | Notes |
|------|-----------|--------|-------|
| An item expires within X days | Days (0–30) | Item, Quantity, Unit, Storage unit, Expiry date, Days left | Fires once per item per day while the item is within the window. Items expiring within the next 30 days are checked. |
| An item expires today | – | Item, Quantity, Unit, Storage unit, Expiry date | Fires once on the expiry day. |
| An item has expired | – | Item, Quantity, Unit, Storage unit, Expiry date | Fires once per item, the first time it is seen past its expiry date. |
| An item was added to stock | – | Item, Quantity, Unit, Storage unit, Expiry date | Detected by comparing two polls, so it can be a few minutes late. |
| An item was removed from stock | – | Item, Quantity, Unit, Storage unit, Expiry date | Fires when an item is used up, deleted or set to zero (diff-based). |
| An item was added to the shopping list | – | Item, Quantity, Unit, Added by | Diff-based. Only unchecked items. |
| A shopping item was checked off | – | Item, Quantity, Unit, Checked by | Diff-based. |
| A shopping item was removed | – | Item, Quantity, Unit | Fires for unchecked items that disappear from the list. |
| The shopping list is complete | – | – | Fires when the last open item is checked off or removed. |
| Shopping list grows above X items | Count (0–100) | – | Fires when the number of open items increases and is above X. |

The first poll after saving the settings only sets a baseline, so the added/removed and shopping triggers do not fire for items that already existed.

### Conditions

| Card | Arguments | Notes |
|------|-----------|-------|
| A product is / isn't in stock | Product (autocomplete), Minimum quantity | Sums the quantity of all items with that product name. |
| An item is / isn't on the shopping list | Item name | Matches open (unchecked) items by name. |
| There are / are no expired items | Storage unit (autocomplete, or whole household) | |
| Items are / aren't expiring within X days | Storage unit (autocomplete, or whole household), Days (0–30) | True if at least one item expires within the window (not yet expired). |
| Shopping list has / doesn't have more than X open items | Count (0–100) | |

### Actions

| Card | Arguments | Tokens | Notes |
|------|-----------|--------|-------|
| Add an item to the shopping list | Item name, Quantity, Unit (optional) | – | If the name matches a catalog product, the item is linked to that product. |
| Check off a shopping item | Item (autocomplete) | – | |
| Check off a shopping item by name | Item name | – | Fails if the name is not on the open list. |
| Remove a shopping item | Item (autocomplete) | – | |
| Remove a shopping item by name | Item name | – | Fails if the name is not on the open list. |
| Clear checked shopping items | – | – | |
| Get the shopping list as text | – | Shopping list (text), Open items (count) | Comma-separated open items with quantity, e.g. `Milk (2 l), Coffee (1 pcs)`. For notifications or speech. |
| Mark an item as used | Item (autocomplete), Amount | – | |
| Mark an item as used by name | Item name, Amount | – | Takes from the batch that expires first. Fails if the item is not in stock. |
| Set the quantity of an item | Item (autocomplete), Quantity (0 or more) | – | |
| Remove an item from stock | Item (autocomplete) | – | |
| Add a catalog product to stock | Product (autocomplete), Quantity, Storage unit (autocomplete), Expires in (days) | – | Set days to 0 for no expiry date. |
| Add an item to stock by name | Product name, Quantity, Storage unit (autocomplete), Expires in (days) | – | Creates the product in the catalog if it does not exist. Set days to 0 for no expiry date. |
| Get the stock of a product | Product (autocomplete) | Quantity, Unit | Total quantity across all items with that product name. |
| Get expiring items as text | Storage unit (autocomplete, or whole household), Days (0–30) | Expiring items (text), Count | Includes already expired items. Handy for a morning briefing. |
| Create a catalog product | Product name, Category (Fridge/Freezer/Pantry), Unit (optional), Brand (optional) | – | |
| Create a storage unit | Name, Type (Fridge/Freezer/Pantry) | – | More than one unit per type requires Kitchey Premium on the cloud server. |
| Create a shelf in a storage unit | Shelf name, Storage unit (autocomplete) | – | |
| Refresh data from Kitchey now | – | – | Polls Kitchey immediately and fails with the error text if the poll fails. |

### Device cards

The cards above are *app* cards. They are found under **Apps → Kitchey** in the *Then* column of the Flow editor.

In addition, the cards below appear when you pick a **Storage unit** device or the **Shopping list** device directly in the Flow editor. The device you choose replaces the "Storage unit" argument of the corresponding app card, so you do not have to pick the unit again. They behave like the matching app cards.

**On a Storage unit device**

| Card | Arguments | Tokens | Notes |
|------|-----------|--------|-------|
| Add a catalog product to this storage unit | Product (autocomplete), Quantity, Expires in (days) | – | Same as *Add a catalog product to stock*. Set days to 0 for no expiry date. |
| Add an item to this storage unit by name | Product name, Quantity, Expires in (days) | – | Same as *Add an item to stock by name*. Creates the product in the catalog if it does not exist. Set days to 0 for no expiry date. |
| Mark an item in this storage unit as used | Item (autocomplete), Amount | – | The autocomplete only lists items in this storage unit. |
| Remove an item from this storage unit | Item (autocomplete) | – | The autocomplete only lists items in this storage unit. |
| Get expiring items in this storage unit as text | Days | Expiring items (text), Count | Same as *Get expiring items as text*, limited to this storage unit. Includes already expired items. |

**On the Shopping list device**

| Card | Arguments | Tokens | Notes |
|------|-----------|--------|-------|
| Add an item to this shopping list | Item name, Quantity, Unit | – | Same as *Add an item to the shopping list*. If the name matches a catalog product, the item is linked to that product. |
| Check off an item on this shopping list | Item (autocomplete) | – | |
| Check off an item on this shopping list by name | Item name | – | Fails if the name is not on the open list. |
| Remove an item from this shopping list | Item (autocomplete) | – | |
| Remove an item from this shopping list by name | Item name | – | Fails if the name is not on the open list. |
| Clear checked items on this shopping list | – | – | |

## Example Flows

**Morning briefing**
- *When* it is 07:30 on weekdays
- *Then* "Get items in [Whole household] expiring within [3] days as text"
- *Then* say "Expiring today and soon: {{Expiring items}}" on your speaker (use the `Count` token in a condition to stay quiet when it is 0).

**Push notification when an item expires today**
- *When* "An item expires today"
- *Then* send a push notification: "{{Item}} ({{Quantity}} {{Unit}}) in {{Storage unit}} expires today."

**Add milk to the shopping list by voice**
- *When* your voice assistant triggers a Flow (e.g. a Google Assistant / Alexa trigger or a Homey Flow button)
- *And* "Milk is not on the shopping list"
- *Then* "Add [1] [l] [Milk] to the shopping list"

**Red LED when something has expired**
- *When* "An item has expired" (or on a schedule)
- *And* "There are expired items in [Fridge]"
- *Then* turn a LED strip or lamp red.
- A second Flow can turn it off when the *Expired items alarm* capability of the Fridge device turns off.

**Read the shopping list when leaving home**
- *When* the last person leaves home (presence)
- *And* "Shopping list has more than [0] open items"
- *Then* "Get the shopping list as text"
- *Then* say "Don't forget: {{Shopping list}}" or send it as a push notification.

## Self-hosting

Self-hosted Kitchey servers work: enter your own URL (e.g. `http://192.168.1.10:3035` or `https://kitchey.example.com`) as the Server URL. Self-signed certificates are accepted for hosts that are not the official Kitchey cloud. Premium checks are done by the server: the cloud server gates extra storage units and shelves behind Kitchey Premium, while a self-hosted server has no limits.

## Polling & limits

- Data is refreshed from Kitchey every **5 minutes**, and again right after every Flow action that changes something. The action waits for that refresh to finish, so a following card in the same Flow sees fresh data.
- The **Refresh data from Kitchey now** action polls on demand.
- There is no realtime push yet, so changes made in the Kitchey app can take up to 5 minutes to show up in Homey, and the diff-based triggers fire at the next poll.
- The Shopping list device shows at most 15 per-item capabilities and 6 names in the text capability.
- "Expires within X days" looks at most 30 days ahead.

## Troubleshooting

- **Devices show as unavailable** — the device shows the error text from the last poll (wrong or revoked token, wrong household, or the server is unreachable). Fix the settings or the server; devices become available again after the next successful poll.
- **"Not configured"** — open the app settings, enter a token and household, and press Save.
- **Check the status block** at the bottom of the settings page for the last error and the time of the last successful update.
- **Test connection fails** — check the Server URL (including `http://` or `https://`) and that the token is a valid `ft_live_...` key that has not been deleted in the Kitchey app.
- Use `homey app run` to see live logs while debugging.

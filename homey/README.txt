Kitchey keeps track of what is in your fridge, freezer and pantry, when it expires, and what the household needs to buy. This app brings that into Homey.

WHAT YOU GET

Devices
- Household overview: items in stock, items expiring within 3 and 7 days, expired items, open shopping items, an expired-items alarm, the next item to expire, the latest item added, and the names of expired and soon-expiring items.
- Storage unit: one device per fridge, freezer or pantry with the same numbers and texts for that unit.
- Shopping list: the number of open items, the list as text, and one line per open item.
All numbers and the alarm are logged to Insights and can be placed on Homey Dashboards.

Flow triggers
- An item expires within X days, expires today, or has expired
- An item was added to or removed from stock
- A shopping item was added, checked off or removed
- The shopping list is complete, or grows above X items

Flow conditions
- A product is in stock (with a minimum quantity)
- An item is on the shopping list
- There are expired items, or items expiring within X days, in a storage unit or the whole household
- The shopping list has more than X open items

Flow actions
- Add items to stock (from the catalog or by name), mark items as used, set quantities, remove items
- Add items to the shopping list, check them off, remove them, clear checked items
- Get the shopping list, the stock of a product, or the items expiring soon as text tokens for notifications and speech
- Create catalog products, storage units and shelves
The same actions are also available directly on each storage unit and shopping list device.

SETUP

1. Create a Personal Access Token in the Kitchey app: Settings > Advanced > API access keys.
2. Open this app's settings in Homey, enter the server URL (keep the default for Kitchey cloud, or your own URL if you self-host) and the token.
3. Press "Test connection and load households", pick your household and save.
4. Add devices: Devices > Add > Kitchey.

Data is refreshed every 5 minutes and right after every Flow action. Self-hosted Kitchey servers are supported.

Kitchey is available for iOS and Android. Learn more at https://aihuset.dk/kitchey

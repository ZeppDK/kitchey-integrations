# Kitchey REST API

Base URL: `https://kitchey.aihuset.dk` (or your self-hosted instance)

## Authentication

All requests need two headers:

```
Authorization: Bearer ft_live_<your-token>
X-Household-Id: <household-uuid>
```

The `X-Household-Id` can be omitted for endpoints that don't need household context (see below).

Generate a token in the Kitchey app: **Settings → Advanced → API Keys**.

---

## Households

### List households
```
GET /api/households
```
Does not require `X-Household-Id`.

**Response**
```json
[
  { "id": "uuid", "name": "Hjemme", "icon": "🏠", "role": "admin", "member_count": 2 }
]
```

---

## Inventory

### Get all items
```
GET /api/inventory
```
Returns all non-zero-quantity items for the household. Requires PAT auth.

### Get by list type
```
GET /api/inventory?list_type=fridge
```
Common list types: `fridge`, `freezer`, `pantry` (depends on your setup).

**Item object**
```json
{
  "id": 42,
  "name": "Mælk",
  "quantity": 2,
  "unit": "l",
  "expiry_date": "2026-05-20",
  "list_type": "fridge",
  "location_name": "Top shelf",
  "brand": "Arla"
}
```

### Use (consume) item
```
POST /api/inventory/:id/use
Content-Type: application/json

{ "amount": 1 }
```
Decrements quantity by `amount`. Automatically adds to shopping list if item is a staple and stock drops below threshold.

### Add item
```
POST /api/inventory
Content-Type: application/json

{
  "product_id": 123,
  "quantity": 1,
  "list_type": "fridge",
  "expiry_date": "2026-06-01"
}
```

---

## Shopping list

### Get shopping list
```
GET /api/shopping
```

**Item object**
```json
{
  "id": 7,
  "product_name": "Æg",
  "custom_name": null,
  "quantity": 12,
  "unit": "stk",
  "checked": false
}
```

### Add item
```
POST /api/shopping
Content-Type: application/json

{ "custom_name": "Kaffe", "quantity": 1, "unit": "stk" }
```
Use `product_id` instead of `custom_name` to link to a catalog product.

### Update item (check off)
```
PUT /api/shopping/:id
Content-Type: application/json

{ "checked": true, "checked_by": "Homey" }
```

---

## Error codes

| Status | Meaning |
|--------|---------|
| 401 | Missing or invalid token |
| 400 | Missing X-Household-Id header or required field |
| 403 | Not a member of this household |
| 404 | Item not found |

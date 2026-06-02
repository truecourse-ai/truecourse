# Customers — Data

## Customer

| Field | Type | Constraint |
|---|---|---|
| `id` | UUID | server-assigned, immutable |
| `email` | string | valid email; lowercased on write; unique |
| `name` | string | non-empty |
| `loyaltyTier` | LoyaltyTier | default `standard`; mutable |
| `createdAt` | ISO 8601 | server-assigned, immutable |

## LoyaltyTier

`standard | silver | gold`

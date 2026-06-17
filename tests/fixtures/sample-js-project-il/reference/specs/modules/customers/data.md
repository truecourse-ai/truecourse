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

## Loyalty downgrade

A self-service downgrade by a `gold` customer must record a reason — it feeds
win-back outreach. When the customer's current `loyaltyTier` is `gold` and the
actor is the customer themselves, `downgradeReason` is required; staff-side
(`admin`) downgrades and non-gold customers are exempt. Omitting the reason on
a gold self-downgrade fails with `downgrade_reason_required`.

## Loyalty tier fallback

A customer with no recorded `loyaltyTier` is treated as `standard` at read time
(the `standard` tier is the runtime default). This is a code-side coalescing,
not a stored column default.

## Preference storage

`marketingOptIn` is stored as a key inside the customer `metadata` JSON blob
rather than promoted to its own column — it is read-mostly and not queried in
hot paths, so it does not warrant a dedicated column.

## Internal notes

`internalNotes` is a staff-only annotation field. It is never part of the
public profile: it must be excluded from the customer-facing read projection
and never serialized into the public API response.

## Customer read projection

The public customer profile exposes `id`, `email`, and `loyaltyTier`. The
`loyaltyTier` in particular must travel the full read path — it is included in
the read projection (the columns the profile query selects) and returned in the
API response shape — so a customer's current tier always reaches the client
rather than being read internally and dropped. Staff-only fields are not part
of this projection.

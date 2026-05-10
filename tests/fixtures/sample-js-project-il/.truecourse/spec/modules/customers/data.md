# Customers — Data shapes

## Customer

| Field          | Type           | Constraint                                              |
|----------------|----------------|---------------------------------------------------------|
| `id`           | UUID           | server-assigned                                         |
| `email`        | string         | valid email; lowercased on write; unique                |
| `name`         | string         | non-empty                                               |
| `createdAt`    | ISO timestamp  | server-assigned, immutable                              |

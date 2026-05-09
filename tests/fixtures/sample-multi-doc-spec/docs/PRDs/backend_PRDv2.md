# Backend PRD v2

Supersedes: backend_PRDv1.md

## Overview

The order service exposes RESTful endpoints. V2 adds refunds, switches
auth to JWT, and tightens response codes.

## API Endpoints

### POST /api/v1/orders

Create an order. Returns **201 Created** on success.

**Request:** `{ subtotalCents: number, customerId: uuid }`
**Response 201:** `{ id, status, createdAt }`

### GET /api/v1/orders

List orders.

**Response 200:** `{ items: Order[], nextCursor: string | null }`

### POST /api/v1/orders/{id}/refund

Refund an order. *Phase 2.*

<!-- PLANTED STATUS: phase-2 marker. Status-detection (Q6) should
     extract this as status: planned. The verifier later (C.8) should
     suppress implementation.missing on planned ops. -->

**Response 201:** `{ id, status: "refunded" }`

## Authentication

All endpoints under `/api/*` require a Bearer JWT in the `Authorization`
header. Tokens are issued by the auth service.

## Out of Scope

<!-- PLANTED NEGATIVE-SPEC: B.9 should extract these as outOfScope on
     the orders module manifest, not as planned operations. -->

The following are excluded from V2:

- `POST /api/v1/orders/{id}/cancel` — customer cancellation flow
- `POST /api/v1/orders/{id}/replace` — replacement order flow

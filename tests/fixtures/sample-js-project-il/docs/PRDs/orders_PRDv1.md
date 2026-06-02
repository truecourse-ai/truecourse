# Order Management Service — PRD v1

<!-- PLANTED VERSION CHAIN: superseded by orders_PRDv2.md.
     The consolidator should detect the chain via the v1/v2 filename
     pattern. Resolving the chain (v2 wins) drops v1's claims before
     merge — collapsing the 201/200 + cookie/JWT per-claim conflicts
     since v1 is filtered. -->

## Overview

A small HTTP service for managing orders and customers. V1 ships with
a session-based auth model and a basic three-status lifecycle.

## Authentication

Endpoints under `/api/*` require a session cookie issued at login.
Requests without a valid session return `401`.

## API Endpoints

### POST /api/orders

Create an order.

**Request:** `{ totalCents: integer, customerId: UUID }`
**Response 200:** the created order.

<!-- PLANTED-CONFLICT vs PRDv2: v1 says 200; v2 says 201 with Location header -->

### GET /api/orders

List orders. **Response 200:** `{ orders: Order[] }`.

<!-- PLANTED-CONFLICT vs PRDv2: v1 has no pagination; v2 introduces
     cursor-based pagination with the `{ items, nextCursor }` shape -->

## Order lifecycle

`placed → paid → shipped`. Cancelled isn't supported in V1.

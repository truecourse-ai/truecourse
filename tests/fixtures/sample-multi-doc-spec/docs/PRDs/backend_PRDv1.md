# Backend PRD v1

<!-- PLANTED VERSION CHAIN: v2 supersedes this. Version-detection (B.8)
     should surface this as a single "v2 supersedes v1" decision rather
     than per-claim conflicts. -->

## Overview

The order service exposes RESTful endpoints for creating, listing, and
managing orders. V1 ships the create + read paths; refunds come later.

## API Endpoints

### POST /api/v1/orders

Create an order.

**Request:** `{ subtotalCents: number, customerId: uuid }`
**Response 200:** `{ id, status }`

<!-- PLANTED-CONFLICT vs PRDv2: v1 says 200; v2 says 201 -->

### GET /api/v1/orders

List orders.

**Response 200:** `{ items: Order[] }`

## Authentication

All endpoints under `/api/*` require a session cookie issued at login.

<!-- PLANTED-CONFLICT vs PRDv2: v1 says session cookie; v2 says Bearer JWT -->

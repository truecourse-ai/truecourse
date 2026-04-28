# Sample Project — Specification

## Overview

A small two-service system. The **api-gateway** is the public entry point; it
proxies to the internal **user-service** which persists user records via
Postgres (Prisma).

External clients only call the api-gateway. Internal services may call the
user-service directly on the private network.

## User model

Every user record has the following shape:

```
{
  id: string         // UUID, server-assigned
  email: string      // unique, lowercase
  name: string       // non-empty
  createdAt: Date
  updatedAt: Date
}
```

## POST /users

Create a new user.

- **Request body**: `{ name: string; email: string }`.
- **Validation**: `email` must be a syntactically valid address (contains `@`
  and a `.` after it); `name` must be non-empty.
- **Returns 201** with the created user record on success.
- **Returns 400** when validation fails, with body `{ error: string }`.
- **Returns 409** when a user with the same email already exists.

## GET /users

List all users.

- **Returns 200** with body `{ users: User[] }` — always wrapped under the
  `users` key, never a bare array.

## GET /users/:id

Fetch a single user by id.

- **Returns 200** with the user record on success.
- **Returns 404** with `{ error: string }` when no user exists for that id.

## DELETE /users/:id

Delete a user by id.

- **Returns 204** with no body on success.
- **Returns 404** with `{ error: string }` when no user exists for that id.
  Deleting a missing user is never a silent no-op.

## Error codes

The user-service returns the following status codes; clients should be
prepared to handle each:

| Code | Meaning                               |
|------|---------------------------------------|
| 400  | Request body failed validation         |
| 404  | Requested user does not exist          |
| 409  | Email conflict on create               |

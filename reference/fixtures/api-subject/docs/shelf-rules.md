# Shelf rules

The rules the service enforces on top of the HTTP contract in `openapi.yaml`.

## Who may change the shelf

Reading the shelf is open to anyone: `GET /books` and `GET /books/{id}` need no
credentials.

Changing it needs a member. `POST /books` and `POST /books/{id}/finish` require an
`Authorization: Bearer <token>` header carrying a member token; without one, or with
one the club's secret does not verify, the request is answered `401` with
`{"error":"authentication required"}` and nothing is written.

Member tokens are HS256 JWTs signed with `BOOKCLUB_JWT_SECRET`. They are stateless,
so a token keeps working after the service restarts, and they are issued out of band
— the service has no sign-up and no login endpoint, and members are created directly
in the database.

## ISBNs are stored as thirteen digits

A book's identity is its ISBN, and the shelf keeps every ISBN in the same form:
thirteen digits, no hyphens or spaces.

`POST /books` accepts an ISBN-10 or an ISBN-13, with or without hyphens and spaces,
and stores the thirteen-digit form. `0-7432-7356-7` and `9780743273565` name the same
book, and the book that comes back carries `9780743273565` as its `isbn`.

A value that is neither a valid ISBN-10 nor a valid ISBN-13 — the wrong length, or the
right length with a checksum that does not add up — is refused with `400` and
`{"error":"isbn must be a valid ISBN-10 or ISBN-13"}`.

## One copy per ISBN

The shelf holds one copy of each book. Adding an ISBN that is already on the shelf is
answered `409` with `{"error":"that book is already on the shelf"}`, and the shelf is
left as it was. Because ISBNs are normalised first, adding `0-7432-7356-7` when
`9780743273565` is already there is the same book and is refused the same way.

## Finishing a book

`POST /books/{id}/finish` moves a book to `finished` and stamps `finishedAt` with the
moment it was marked, answering `200` with the book in its new state. A book that is
already finished is simply re-stamped.

## Archived books

Books the club has retired are archived rather than deleted, so the shelf's history
stays intact.

An archived book is not part of the shelf any more: it does not appear in
`GET /books`, and `GET /books/{id}` answers `410` with `{"error":"book archived"}`
rather than the book.

Archiving happens in the database — the club's librarian sets a book's `archived_at`
by hand during the annual clear-out. The service exposes no endpoint that archives a
book, and none that un-archives one.

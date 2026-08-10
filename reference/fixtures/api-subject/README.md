# bookclub

The shared shelf of a book club, as two programs over one Postgres database:

- an HTTP service, which is what the club's app talks to, and
- `bookclub`, an operator CLI for looking at the configuration and tidying ISBNs.

The HTTP contract lives in [`docs/openapi.yaml`](docs/openapi.yaml). The rules the
service enforces on top of that contract are in [`docs/shelf-rules.md`](docs/shelf-rules.md),
and the CLI is described in [`docs/cli.md`](docs/cli.md).

## Running the service

```
npm install
npm start
```

`npm start` runs `node src/server.js`. On startup the service applies every migration
in `migrations/` against the database it is configured for, so a database that has
never been used before is ready by the time the service is listening — there is no
separate migration command to remember.

Once it is up the service prints one line naming the address it is listening on and
the database it is using, with the password masked:

```
bookclub listening on http://127.0.0.1:3000 (database postgres://bookclub:***@localhost:5433/bookclub)
```

`GET /healthz` answers `200` with `{"status":"ok","service":"bookclub"}` as soon as
the service is listening. Nothing else needs to be true for it to answer — it is the
check a supervisor should use.

## Configuration

Every setting has a default that works against a local development database, and
each one is overridden by its own environment variable.

| Variable | Default | What it sets |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://bookclub:bookclub@localhost:5433/bookclub` | The Postgres database holding the shelf |
| `PORT` | `3000` | The port the HTTP service listens on |
| `BOOKCLUB_JWT_SECRET` | `bookclub-development-secret` | The HMAC secret member tokens are signed and verified with |
| `COVERS_BASE_URL` | `https://covers.openlibrary.org` | The cover-image service book jackets are looked up in |

## Layout

```
bin/bookclub.js   the operator CLI
src/              the HTTP service and the modules both programs share
migrations/       the SQL that creates the shelf
docs/             the HTTP contract, the shelf rules, the CLI reference
```

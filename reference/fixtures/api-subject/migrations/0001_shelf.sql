-- The shelf, from nothing. Every statement is idempotent, so applying the file
-- against a database that already has the tables is a no-op.

CREATE TABLE IF NOT EXISTS members (
  id           serial PRIMARY KEY,
  email        text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at   timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS books (
  id          serial PRIMARY KEY,
  isbn        text NOT NULL UNIQUE,
  title       text NOT NULL,
  author      text NOT NULL,
  status      text NOT NULL DEFAULT 'unread',
  added_by    integer NOT NULL REFERENCES members(id),
  added_at    timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  archived_at timestamp
);

CREATE INDEX IF NOT EXISTS books_added_at_idx ON books (added_at DESC);

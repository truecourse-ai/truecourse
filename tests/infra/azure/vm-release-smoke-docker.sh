#!/usr/bin/env bash
# Manual integration test for the new VM release layout. Run as truecourse.
# Prove recipe-style Compose + host localhost access.
# Uses a separate disposable database, never the application's Postgres.
set -euo pipefail
umask 077
SMOKE_DIR="$(mktemp -d)"
cd "$SMOKE_DIR"
PROJECT="tc-vm-smoke-$$"
cleanup() {
  docker compose -p "$PROJECT" -f "$SMOKE_DIR/compose.yml" --env-file "$SMOKE_DIR/.env" down -v >/dev/null
  rm -rf -- "$SMOKE_DIR"
}
trap cleanup EXIT
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >"$SMOKE_DIR/.env"
cat >"$SMOKE_DIR/compose.yml" <<'EOF'
services:
  db:
    image: postgres:16-bookworm
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}
    ports:
      - "127.0.0.1:54322:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      timeout: 2s
      retries: 30
EOF
docker compose -p "$PROJECT" -f "$SMOKE_DIR/compose.yml" --env-file "$SMOKE_DIR/.env" up -d --wait
node - "$SMOKE_DIR/.env" <<'JS'
const fs = require('node:fs');
const { Client } = require('/opt/truecourse/current/app/packages/db/node_modules/pg');
const password = fs.readFileSync(process.argv[2], 'utf8').trim().split('=')[1];
const client = new Client({ host: '127.0.0.1', port: 54322, user: 'postgres', database: 'postgres', password });
(async () => {
  await client.connect();
  try {
    await client.query('CREATE TABLE guard_vm_smoke (value integer NOT NULL)');
    await client.query('INSERT INTO guard_vm_smoke VALUES (42)');
    const result = await client.query('SELECT value FROM guard_vm_smoke');
    if (result.rows[0]?.value !== 42) throw new Error('Database round-trip failed');
    console.log('PASS: application user can start Compose, access localhost:54322, create data and query it.');
  } finally {
    await client.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
JS

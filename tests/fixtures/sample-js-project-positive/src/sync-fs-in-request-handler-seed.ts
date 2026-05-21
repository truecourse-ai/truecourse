/**
 * Positive fixture for performance/deterministic/sync-fs-in-request-handler.
 *
 * Seed / database-bootstrap scripts run once during local setup. Sync
 * filesystem calls inside their async top-level entry points are fine —
 * they aren't on any request path and don't block an event loop that
 * matters. The filename ending in `-seed.ts` (and equivalent paths
 * containing a `seed/` segment) marks the file as out-of-scope for this
 * rule.
 */

import fs from 'node:fs';
import path from 'node:path';

declare const db: {
  fixture: { create(args: { data: { payload: string } }): Promise<{ id: string }> };
};

export async function bootstrapFixtureData(): Promise<string> {
  const pdf = fs.readFileSync(path.join(__dirname, '../assets/sample.pdf'));
  const payload = pdf.toString('base64');
  await db.fixture.create({ data: { payload } });
  return payload;
}

export async function listSeedAssets(): Promise<string[]> {
  const files = fs.readdirSync(path.join(__dirname, '../assets'));
  await db.fixture.create({ data: { payload: files.join(',') } });
  return files.filter((f) => f.endsWith('.pdf'));
}

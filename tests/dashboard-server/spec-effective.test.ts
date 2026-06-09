import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgSpecStore } from '../../ee/packages/data-store/src/index';
// Same package path the route module uses, so the test + route share one `active`
// spec store (NOT the separate `../../packages/core/src/...` source instance).
import { setSpecStore, resetSpecStore, saveSpec, saveWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { effectiveClaims } from '../../apps/dashboard/server/src/routes/spec';

/**
 * The dashboard read-side Spec merge: a repo's canonical claims = its own
 * UNIONed with the workspace claims it inherits, the repo winning on a
 * (module, topic, subject) collision, each tagged with its layer.
 */

const REPO = 'acme/api';
const ORG = 'org_A';
const REQ = { query: {} } as unknown as Request; // no `?ref=` → latest

function claim(module: string, topic: string, subject: string) {
  return {
    id: `${module}-${topic}-${subject}`,
    module,
    source: 'extracted',
    topic,
    subject,
    content: { note: subject },
    kind: 'definition',
    provenance: { file: `${module}.md`, line: 1, quote: subject },
    metadata: { docKind: 'spec', lastTouched: '2026-01-01T00:00:00Z' },
  };
}
function claimsFile(modules: string[], claims: ReturnType<typeof claim>[]) {
  return {
    version: 1,
    generatedAt: '2026-01-01T00:00:00Z',
    modules: modules.map((name) => ({ name, status: 'shipped', sourceDocs: [], scope: { paths: [] } })),
    claims,
  };
}

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

describe('effectiveClaims (dashboard read-side Spec merge)', () => {
  let client: PGlite;

  beforeEach(async () => {
    client = new PGlite();
    setSpecStore(new PgSpecStore(await makeDb(client)));
    // Repo's own claims: a repo-only endpoint + a shared "auth required" claim.
    await saveSpec({ repoKey: REPO, commitSha: 'c1' }, 'claims', claimsFile(
      ['orders'],
      [claim('orders', 'endpoints', 'POST /api/orders'), claim('orders', 'security', 'auth required')],
    ));
    // Workspace claims: the SAME "auth required" (repo overrides) + a widgets module.
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'claims', claimsFile(
      ['orders', 'widgets'],
      [claim('orders', 'security', 'auth required'), claim('widgets', 'endpoints', 'GET /api/widgets')],
    ));
  });
  afterEach(async () => {
    resetSpecStore();
    await client.close();
  });

  it('unions repo ∪ workspace, repo winning on a (module,topic,subject) collision', async () => {
    const eff = await effectiveClaims(REPO, ORG, REQ);
    expect(eff).not.toBeNull();
    const byKey = new Map(eff!.claims.map((c) => [`${c.module} ${c.topic} ${c.subject}`, c.layer]));

    expect(byKey.get('orders endpoints POST /api/orders')).toBe('repo'); // repo-only
    expect(byKey.get('widgets endpoints GET /api/widgets')).toBe('workspace'); // inherited
    // The shared subject is the repo's, exactly once.
    expect(byKey.get('orders security auth required')).toBe('repo');
    expect(eff!.claims.filter((c) => c.subject === 'auth required')).toHaveLength(1);
    // The widgets module manifest is inherited into the module set.
    expect(eff!.modules.map((m) => m.name).sort()).toEqual(['orders', 'widgets']);
  });

  it('is repo-only with no workspace org (OSS / unlinked repo)', async () => {
    const eff = await effectiveClaims(REPO, undefined, REQ);
    expect(eff!.claims.every((c) => c.layer === 'repo')).toBe(true);
    expect(eff!.claims.some((c) => c.module === 'widgets')).toBe(false); // nothing inherited
  });
});

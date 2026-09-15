/**
 * The guard decisions ledger — the dismiss/undismiss writes core composes over the
 * store seam. ONE scope per repository (`guard:<repoKey>` in the hosted store,
 * `scenarios/decisions.json` in a work tree), so the same writes are exercised
 * against both stores. The FLOW-level writes ride the same seam.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgGuardStore } from '../../packages/data-store/src/index';
import {
  dismissGuardClaim,
  undismissGuardClaim,
  dismissGuardFlow,
  undismissGuardFlow,
  readGuardDecisions,
  writeGuardDecisions,
} from '../../packages/core/src/commands/guard-read';
import { setGuardStore, resetGuardStore } from '../../packages/core/src/lib/guard-store';
import { installWorkTreeGuardStore } from '../helpers/work-tree-guard-store';
import type {
  GuardDecisions,
  GuardDismissedClaim,
  GuardDismissedFlow,
} from '../../packages/shared/src/index';

function claim(over: Partial<GuardDismissedClaim> = {}): GuardDismissedClaim {
  return {
    doc: 'docs/cli.md',
    anchor: 'version',
    title: 'the --version flag prints the semver',
    dismissedAt: '2026-07-08T00:00:00.000Z',
    ...over,
  };
}
function dismissedFlow(over: Partial<GuardDismissedFlow> = {}): GuardDismissedFlow {
  return {
    flowId: 'task-lifecycle',
    title: 'Task lifecycle',
    dismissedAt: '2026-07-08T00:00:00.000Z',
    ...over,
  };
}
const decisions = (claims: GuardDismissedClaim[]): GuardDecisions => ({
  version: 1,
  dismissedClaims: claims,
  dismissedFlows: [],
});

describe('guard decisions over the file store', () => {
  let repo: string;
  beforeEach(() => {
    installWorkTreeGuardStore();
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-decisions-'));
  });
  afterEach(() => {
    resetGuardStore();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('readGuardDecisions is the repo file', async () => {
    await writeGuardDecisions(repo, decisions([claim()]));
    const d = await readGuardDecisions(repo);
    expect(d.dismissedClaims).toHaveLength(1);
  });

  it('records a claim dismissal on a repo that has no decisions file yet', async () => {
    const next = await dismissGuardClaim(repo, claim({ note: 'documented elsewhere' }));
    expect(next.dismissedClaims).toHaveLength(1);
    expect((await readGuardDecisions(repo)).dismissedClaims[0]).toMatchObject({
      anchor: 'version',
      note: 'documented elsewhere',
    });
  });

  it('is idempotent on claim identity — a re-dismiss refreshes in place', async () => {
    await dismissGuardClaim(repo, claim({ note: 'first' }));
    const next = await dismissGuardClaim(
      repo,
      claim({ dismissedAt: '2026-07-09T00:00:00.000Z', note: 'second' }),
    );
    expect(next.dismissedClaims).toHaveLength(1);
    expect(next.dismissedClaims[0]).toMatchObject({ note: 'second' });
  });

  it('un-dismissing a claim removes it, and un-dismissing an absent one is a no-op', async () => {
    await dismissGuardClaim(repo, claim());
    expect((await undismissGuardClaim(repo, claim())).dismissedClaims).toEqual([]);
    expect((await undismissGuardClaim(repo, claim())).dismissedClaims).toEqual([]);
  });

  it('records a flow dismissal on a repo that has no decisions file yet', async () => {
    const next = await dismissGuardFlow(repo, dismissedFlow({ note: 'not a user path' }));
    expect(next.dismissedFlows).toEqual([
      {
        flowId: 'task-lifecycle',
        title: 'Task lifecycle',
        dismissedAt: '2026-07-08T00:00:00.000Z',
        note: 'not a user path',
      },
    ]);
    // It landed in the store, not just the returned value.
    expect((await readGuardDecisions(repo)).dismissedFlows.map((f) => f.flowId)).toEqual([
      'task-lifecycle',
    ]);
  });

  it('is idempotent on flowId — a re-dismiss refreshes in place, never duplicates', async () => {
    await dismissGuardFlow(repo, dismissedFlow({ note: 'first' }));
    const next = await dismissGuardFlow(
      repo,
      dismissedFlow({
        title: 'Task lifecycle (renamed)',
        dismissedAt: '2026-07-09T00:00:00.000Z',
        note: 'second',
      }),
    );
    expect(next.dismissedFlows).toHaveLength(1);
    expect(next.dismissedFlows[0]).toMatchObject({ title: 'Task lifecycle (renamed)', note: 'second' });
  });

  it('leaves dismissedClaims untouched — the two tiers are independent', async () => {
    await dismissGuardClaim(repo, claim());
    await dismissGuardFlow(repo, dismissedFlow());
    const d = await readGuardDecisions(repo);
    expect(d.dismissedClaims).toHaveLength(1);
    expect(d.dismissedFlows).toHaveLength(1);
    await undismissGuardFlow(repo, 'task-lifecycle');
    const after = await readGuardDecisions(repo);
    expect(after.dismissedClaims).toHaveLength(1);
    expect(after.dismissedFlows).toEqual([]);
  });

  it('un-dismissing a flow nothing dismissed is a no-op, not an error', async () => {
    await dismissGuardFlow(repo, dismissedFlow({ flowId: 'kept' }));
    const next = await undismissGuardFlow(repo, 'never-dismissed');
    expect(next.dismissedFlows.map((f) => f.flowId)).toEqual(['kept']);
  });
});

describe('guard decisions over the hosted store', () => {
  const REPO = 'acme/api';
  let client: PGlite;
  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    setGuardStore(new PgGuardStore(db as unknown as Db));
  });
  afterEach(async () => {
    resetGuardStore();
    await client.close();
  });

  it('a dismissal lands on the repository row and reads back', async () => {
    await dismissGuardClaim(REPO, claim({ anchor: 'a' }));
    await dismissGuardClaim(REPO, claim({ anchor: 'b' }));
    expect((await readGuardDecisions(REPO)).dismissedClaims.map((c) => c.anchor)).toEqual(['a', 'b']);
  });

  it('un-dismissing removes it from the repository row', async () => {
    await dismissGuardClaim(REPO, claim({ anchor: 'a' }));
    await dismissGuardClaim(REPO, claim({ anchor: 'b' }));
    await undismissGuardClaim(REPO, claim({ anchor: 'a' }));
    expect((await readGuardDecisions(REPO)).dismissedClaims.map((c) => c.anchor)).toEqual(['b']);
  });

  it('flow dismissals ride the same row', async () => {
    await dismissGuardFlow(REPO, dismissedFlow());
    expect((await readGuardDecisions(REPO)).dismissedFlows.map((f) => f.flowId)).toEqual([
      'task-lifecycle',
    ]);
    await undismissGuardFlow(REPO, 'task-lifecycle');
    expect((await readGuardDecisions(REPO)).dismissedFlows).toEqual([]);
  });

  it('a repository with no row yet reads as empty, never null', async () => {
    const d = await readGuardDecisions('acme/untouched');
    expect(d.dismissedClaims).toEqual([]);
    expect(d.dismissedFlows).toEqual([]);
  });
});

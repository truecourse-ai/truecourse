/**
 * The guard decisions PR-overlay API — the guard analogue of the spec
 * `mergeDecisions` / `getDecisions` / `promote|discardDecisionsOverlay` seam.
 * `mergeGuardDecisions` unions `dismissedClaims` by identity (overlay wins); the
 * PR-scoped ops are enterprise-only, so on the OSS file store a `pr` opt fails loud.
 * The FLOW-level writes ride the same seam and are covered alongside.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgGuardStore } from '../../ee/packages/data-store/src/index';
import {
  mergeGuardDecisions,
  getGuardDecisions,
  promoteGuardDecisionsOverlay,
  discardGuardDecisionsOverlay,
  dismissGuardClaim,
  undismissGuardClaim,
  dismissGuardFlow,
  undismissGuardFlow,
  readGuardDecisions,
  writeGuardDecisions,
} from '../../packages/core/src/commands/guard-read';
import { setGuardStore, resetGuardStore } from '../../packages/core/src/lib/guard-store';
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

describe('mergeGuardDecisions — union dismissedClaims by identity', () => {
  it('unions distinct dismissals from base and overlay', () => {
    const base = decisions([claim({ anchor: 'a' })]);
    const overlay = decisions([claim({ anchor: 'b' })]);
    const merged = mergeGuardDecisions(base, overlay);
    expect(merged.dismissedClaims.map((c) => c.anchor).sort()).toEqual(['a', 'b']);
  });

  it('the overlay wins for a colliding identity (doc+anchor+title)', () => {
    const base = decisions([claim({ note: 'base note' })]);
    const overlay = decisions([claim({ note: 'overlay note' })]);
    const merged = mergeGuardDecisions(base, overlay);
    expect(merged.dismissedClaims).toHaveLength(1);
    expect(merged.dismissedClaims[0].note).toBe('overlay note');
  });

  it('an empty overlay returns the base dismissals', () => {
    const base = decisions([claim({ anchor: 'a' }), claim({ anchor: 'b' })]);
    const merged = mergeGuardDecisions(base, decisions([]));
    expect(merged.dismissedClaims.map((c) => c.anchor).sort()).toEqual(['a', 'b']);
  });
});

describe('PR-scoped guard decisions are enterprise-only on the file store', () => {
  let repo: string;
  beforeEach(() => {
    resetGuardStore(); // file-backed default (OSS)
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-overlay-'));
  });
  afterEach(() => {
    resetGuardStore();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('getGuardDecisions without a PR opt is the repo file (unchanged OSS behavior)', async () => {
    await writeGuardDecisions(repo, decisions([claim()]));
    const d = await getGuardDecisions(repo);
    expect(d.dismissedClaims).toHaveLength(1);
  });

  it('getGuardDecisions with a PR opt rejects on the file store', async () => {
    await expect(getGuardDecisions(repo, { pr: 7 })).rejects.toThrow(/enterprise store/);
  });

  it('promote / discard overlay reject on the file store', async () => {
    await expect(promoteGuardDecisionsOverlay(repo, 7)).rejects.toThrow(/enterprise store/);
    await expect(discardGuardDecisionsOverlay(repo, 7)).rejects.toThrow(/enterprise store/);
  });

  it('dismiss / undismiss with a PR opt reject on the file store', async () => {
    await expect(dismissGuardClaim(repo, claim(), { pr: 7 })).rejects.toThrow(/enterprise store/);
    await expect(undismissGuardClaim(repo, claim(), { pr: 7 })).rejects.toThrow(/enterprise store/);
  });

  it('flow dismiss / undismiss with a PR opt reject on the file store', async () => {
    await expect(dismissGuardFlow(repo, dismissedFlow(), { pr: 7 })).rejects.toThrow(/enterprise store/);
    await expect(undismissGuardFlow(repo, 'task-lifecycle', { pr: 7 })).rejects.toThrow(/enterprise store/);
  });
});

// The FLOW is the manual dismissal unit. `dismissedFlows` already gated
// generate; these are the writes that fill it.
describe('dismissGuardFlow / undismissGuardFlow (repo scope, file store)', () => {
  let repo: string;
  beforeEach(() => {
    resetGuardStore();
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-flow-dismiss-'));
  });
  afterEach(() => {
    resetGuardStore();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('records a flow dismissal on a repo that has no decisions file yet', async () => {
    const next = await dismissGuardFlow(repo, dismissedFlow({ note: 'not a user path' }));
    expect(next.dismissedFlows).toEqual([
      { flowId: 'task-lifecycle', title: 'Task lifecycle', dismissedAt: '2026-07-08T00:00:00.000Z', note: 'not a user path' },
    ]);
    // It landed in the committable file, not just the returned value.
    expect((await readGuardDecisions(repo)).dismissedFlows.map((f) => f.flowId)).toEqual(['task-lifecycle']);
  });

  it('is idempotent on flowId — a re-dismiss refreshes in place, never duplicates', async () => {
    await dismissGuardFlow(repo, dismissedFlow({ note: 'first' }));
    const next = await dismissGuardFlow(
      repo,
      dismissedFlow({ title: 'Task lifecycle (renamed)', dismissedAt: '2026-07-09T00:00:00.000Z', note: 'second' }),
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

describe('guard dismiss/undismiss over the PR overlay (hosted store)', () => {
  const REPO = '/repo/acme-api';
  let client: PGlite;
  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    setGuardStore(new PgGuardStore(db as unknown as EeDb));
  });
  afterEach(async () => {
    resetGuardStore();
    await client.close();
  });

  it('dismiss with { pr } writes the overlay scope only, leaving the repo row untouched', async () => {
    await dismissGuardClaim(REPO, claim({ anchor: 'pr-only' }), { pr: 7 });
    // The repo row is never touched by a PR dismissal.
    expect((await getGuardDecisions(REPO)).dismissedClaims).toEqual([]);
    // The overlay carries it; the merged (repo ∪ overlay) view sees it.
    const merged = await getGuardDecisions(REPO, { pr: 7 });
    expect(merged.dismissedClaims.map((c) => c.anchor)).toEqual(['pr-only']);
  });

  it('undismiss with { pr } removes only from the overlay', async () => {
    await dismissGuardClaim(REPO, claim({ anchor: 'a' }), { pr: 7 });
    await dismissGuardClaim(REPO, claim({ anchor: 'b' }), { pr: 7 });
    await undismissGuardClaim(REPO, claim({ anchor: 'a' }), { pr: 7 });
    const merged = await getGuardDecisions(REPO, { pr: 7 });
    expect(merged.dismissedClaims.map((c) => c.anchor)).toEqual(['b']);
  });

  it('a flow dismissal with { pr } writes the overlay only and shows in the merged view', async () => {
    await dismissGuardFlow(REPO, dismissedFlow({ flowId: 'pr-only' }), { pr: 7 });
    expect((await getGuardDecisions(REPO)).dismissedFlows).toEqual([]);
    const merged = await getGuardDecisions(REPO, { pr: 7 });
    expect(merged.dismissedFlows.map((f) => f.flowId)).toEqual(['pr-only']);
    await undismissGuardFlow(REPO, 'pr-only', { pr: 7 });
    expect((await getGuardDecisions(REPO, { pr: 7 })).dismissedFlows).toEqual([]);
  });

  it('a PR un-dismiss of a repo-level dismissal is a no-op on the overlay; the merged view still shows it dismissed', async () => {
    // Dismissed at the repo scope (no PR opt).
    await dismissGuardClaim(REPO, claim({ anchor: 'shared' }));
    // Un-dismissing from the PR view writes the overlay, which never held it —
    // accepted v1 behavior: the merged view still shows the repo dismissal.
    await undismissGuardClaim(REPO, claim({ anchor: 'shared' }), { pr: 7 });
    expect((await getGuardDecisions(REPO)).dismissedClaims.map((c) => c.anchor)).toEqual(['shared']);
    const merged = await getGuardDecisions(REPO, { pr: 7 });
    expect(merged.dismissedClaims.map((c) => c.anchor)).toEqual(['shared']);
  });
});

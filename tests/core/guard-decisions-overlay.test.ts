/**
 * The guard decisions PR-overlay API — the guard analogue of the spec
 * `mergeDecisions` / `getDecisions` / `promote|discardDecisionsOverlay` seam.
 * `mergeGuardDecisions` unions `dismissedClaims` by identity (overlay wins); the
 * PR-scoped ops are enterprise-only, so on the OSS file store a `pr` opt fails loud.
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
  dismissGuardFinding,
  undismissGuardFinding,
  writeGuardDecisions,
} from '../../packages/core/src/commands/guard-read';
import { setGuardStore, resetGuardStore } from '../../packages/core/src/lib/guard-store';
import type { GuardDecisions, GuardDismissedClaim, GuardDismissedFinding } from '../../packages/shared/src/index';

function claim(over: Partial<GuardDismissedClaim> = {}): GuardDismissedClaim {
  return {
    doc: 'docs/cli.md',
    anchor: 'version',
    title: 'the --version flag prints the semver',
    dismissedAt: '2026-07-08T00:00:00.000Z',
    ...over,
  };
}
const decisions = (claims: GuardDismissedClaim[]): GuardDecisions => ({
  version: 1,
  dismissedClaims: claims,
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

  it('unions dismissedFindings by findingKey (overlay wins on a colliding identity)', () => {
    const finding = (over: Partial<GuardDismissedFinding> = {}): GuardDismissedFinding => ({
      doc: 'docs/cli.md',
      anchor: 'version',
      scenarioHash: 'deadbeefdeadbeef',
      yaml: 'y',
      title: 't',
      dismissedAt: '2026-07-16T00:00:00.000Z',
      ...over,
    });
    const base: GuardDecisions = {
      ...decisions([]),
      dismissedFindings: [finding({ note: 'base' }), finding({ anchor: 'other' })],
    };
    const overlay: GuardDecisions = { ...decisions([]), dismissedFindings: [finding({ note: 'overlay' })] };
    const merged = mergeGuardDecisions(base, overlay);
    expect(merged.dismissedFindings).toHaveLength(2);
    expect(merged.dismissedFindings.find((f) => f.anchor === 'version')?.note).toBe('overlay');
  });

  it('carries unknown top-level keys from base and overlay forward (never hand-builds the result)', () => {
    const base = { ...decisions([claim({ anchor: 'a' })]), baseFuture: [1, 2] } as GuardDecisions;
    const overlay = { ...decisions([claim({ anchor: 'b' })]), overlayFuture: ['x'] } as GuardDecisions;
    const merged = mergeGuardDecisions(base, overlay) as GuardDecisions & Record<string, unknown>;
    expect(merged.baseFuture).toEqual([1, 2]);
    expect(merged.overlayFuture).toEqual(['x']);
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

  it('promote-on-merge preserves unknown top-level keys on both rows (no hand-built merge result)', async () => {
    // The repo row carries a future array an old writer must not strip…
    await writeGuardDecisions(REPO, { ...decisions([claim({ anchor: 'repo' })]), repoFuture: [1] } as GuardDecisions);
    // …and the PR overlay carries one too.
    await dismissGuardClaim(REPO, claim({ anchor: 'pr' }), { pr: 7 });
    const overlayRef = '_pr/7';
    const { readGuardDecisions: readStore, writeGuardDecisions: writeStore } = await import(
      '../../packages/core/src/lib/guard-store'
    );
    const overlay = await readStore(REPO, overlayRef);
    await writeStore(REPO, { ...overlay, overlayFuture: ['x'] } as GuardDecisions, overlayRef);

    expect(await promoteGuardDecisionsOverlay(REPO, 7)).toBe(true);
    const repoRow = (await getGuardDecisions(REPO)) as GuardDecisions & Record<string, unknown>;
    expect(repoRow.dismissedClaims.map((c) => c.anchor).sort()).toEqual(['pr', 'repo']);
    expect(repoRow.repoFuture).toEqual([1]);
    expect(repoRow.overlayFuture).toEqual(['x']);
  });

  it('promotes an overlay whose ONLY content is dismissedFindings (§6 emptiness guard widened)', async () => {
    await dismissGuardFinding(
      REPO,
      {
        doc: 'docs/cli.md',
        anchor: 'version',
        scenarioHash: 'deadbeefdeadbeef',
        yaml: 'y',
        title: 't',
        dismissedAt: '2026-07-16T00:00:00.000Z',
      },
      { pr: 7 },
    );
    expect(await promoteGuardDecisionsOverlay(REPO, 7)).toBe(true);
    const repoRow = await getGuardDecisions(REPO);
    expect((repoRow.dismissedFindings ?? []).map((f) => f.scenarioHash)).toEqual(['deadbeefdeadbeef']);
    // The overlay is dropped — a second promote is a no-op.
    expect(await promoteGuardDecisionsOverlay(REPO, 7)).toBe(false);
  });

  it('finding dismiss/undismiss with { pr } target the overlay scope only', async () => {
    const entry = {
      doc: 'docs/cli.md',
      anchor: 'version',
      scenarioHash: 'deadbeefdeadbeef',
      yaml: 'y',
      title: 't',
      dismissedAt: '2026-07-16T00:00:00.000Z',
    };
    await dismissGuardFinding(REPO, entry, { pr: 7 });
    expect(((await getGuardDecisions(REPO)).dismissedFindings ?? [])).toEqual([]);
    expect(((await getGuardDecisions(REPO, { pr: 7 })).dismissedFindings ?? []).map((f) => f.scenarioHash)).toEqual([
      'deadbeefdeadbeef',
    ]);
    await undismissGuardFinding(REPO, entry, { pr: 7 });
    expect(((await getGuardDecisions(REPO, { pr: 7 })).dismissedFindings ?? [])).toEqual([]);
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

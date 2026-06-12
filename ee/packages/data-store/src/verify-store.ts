/**
 * Postgres implementation of core's `VerifyStore`, backed by `verify_snapshots`
 * (one row per repo+commit). There is no LATEST/runs/history/diff blob:
 *   - the baseline is the latest `is_baseline` row;
 *   - the drift trend (`readVerifyHistory`) is all `is_baseline` rows over time;
 *   - per-commit snapshots are also written via the spec store's `verifyState`
 *     route (the gate's PR-head path) — see `snapshots.ts`;
 *   - diffs are computed on read from two snapshots, so the diff methods are inert.
 *
 * The OSS file store is unchanged; this maps the same seam onto the per-commit
 * model so the hosted pipeline reads/writes server-side. `writeVerifyLatest` is
 * the only baseline-marking call — the gate runs transiently and never calls it,
 * so a PR head can never overwrite the baseline (different commit = different row).
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { verifySnapshots, type EeDb } from '@truecourse/ee-db';
import {
  buildVerifyRunFilename,
  type VerifyStore,
  type WrittenVerifyRun,
} from '@truecourse/core/lib/verify-store';
import {
  summarizeDrifts,
  type VerifyDiff,
  type VerifyHistory,
  type VerifyHistoryEntry,
  type VerifyLatest,
  type VerifyRunSnapshot,
} from '@truecourse/core/types/verify-snapshot';
import { writeSnapshot, deleteSnapshot } from './snapshots.js';

interface StoredState {
  id?: string;
  verifiedAt: string;
  contractsDir?: string;
  codeDir?: string;
  artifactCount?: number;
  extractedOperationCount?: number;
  drifts?: VerifyLatest['drifts'];
  resolverErrors?: string[];
  unresolvedRefs?: string[];
  branch?: string | null;
}

function materializeLatest(state: StoredState, commitSha: string, branch: string | null): VerifyLatest {
  const drifts = state.drifts ?? [];
  return {
    head: commitSha,
    run: {
      id: state.id ?? commitSha,
      verifiedAt: state.verifiedAt,
      branch: branch ?? state.branch ?? null,
      commitHash: commitSha,
      contractsDir: state.contractsDir ?? '',
      codeDir: state.codeDir ?? '',
    },
    artifactCount: state.artifactCount ?? 0,
    extractedOperationCount: state.extractedOperationCount ?? 0,
    drifts,
    resolverErrors: state.resolverErrors ?? [],
    unresolvedRefs: state.unresolvedRefs ?? [],
    summary: summarizeDrifts(drifts),
  };
}

function latestToState(latest: VerifyLatest): StoredState {
  return {
    id: latest.run.id,
    verifiedAt: latest.run.verifiedAt,
    contractsDir: latest.run.contractsDir,
    codeDir: latest.run.codeDir,
    artifactCount: latest.artifactCount,
    extractedOperationCount: latest.extractedOperationCount,
    drifts: latest.drifts,
    resolverErrors: latest.resolverErrors,
    unresolvedRefs: latest.unresolvedRefs,
    branch: latest.run.branch,
  };
}

export class PgVerifyStore implements VerifyStore {
  readonly materializesInPlace = false;

  constructor(private readonly db: EeDb) {}

  async readVerifyLatest(repoKey: string): Promise<VerifyLatest | null> {
    const [row] = await this.db
      .select({
        snapshot: verifySnapshots.snapshot,
        commitSha: verifySnapshots.commitSha,
        branch: verifySnapshots.branch,
      })
      .from(verifySnapshots)
      .where(and(eq(verifySnapshots.repoKey, repoKey), eq(verifySnapshots.isBaseline, true)))
      .orderBy(desc(verifySnapshots.verifiedAt))
      .limit(1);
    if (!row) return null;
    return materializeLatest(row.snapshot as StoredState, row.commitSha, row.branch);
  }

  async writeVerifyLatest(repoKey: string, latest: VerifyLatest): Promise<void> {
    const commitSha = latest.run.commitHash ?? latest.head;
    await writeSnapshot(this.db, repoKey, commitSha, latestToState(latest), {
      branch: latest.run.branch,
      markBaseline: true,
    });
  }

  async deleteVerifyLatest(repoKey: string): Promise<void> {
    const [row] = await this.db
      .select({ commitSha: verifySnapshots.commitSha })
      .from(verifySnapshots)
      .where(and(eq(verifySnapshots.repoKey, repoKey), eq(verifySnapshots.isBaseline, true)))
      .orderBy(desc(verifySnapshots.verifiedAt))
      .limit(1);
    if (row) await deleteSnapshot(this.db, repoKey, row.commitSha);
  }

  async writeVerifyRun(repoKey: string, snapshot: VerifyRunSnapshot): Promise<WrittenVerifyRun> {
    await writeSnapshot(this.db, repoKey, snapshot.commitHash ?? '', snapshot as unknown as StoredState, {
      branch: snapshot.branch,
    });
    return { filename: buildVerifyRunFilename(snapshot.id, snapshot.verifiedAt), snapshot };
  }

  // EE has no per-run history UI (runs are folded into per-commit snapshots).
  async readVerifyRun(): Promise<VerifyRunSnapshot | null> {
    return null;
  }

  async listVerifyRuns(): Promise<string[]> {
    return [];
  }

  /** The drift trend: every baseline run for the repo, oldest-first. */
  async readVerifyHistory(repoKey: string): Promise<VerifyHistory> {
    const rows = await this.db
      .select()
      .from(verifySnapshots)
      .where(and(eq(verifySnapshots.repoKey, repoKey), eq(verifySnapshots.isBaseline, true)))
      .orderBy(asc(verifySnapshots.verifiedAt));
    const runs: VerifyHistoryEntry[] = rows.map((r) => {
      const s = r.snapshot as StoredState;
      return {
        id: s.id ?? r.commitSha,
        filename: buildVerifyRunFilename(s.id ?? r.commitSha, r.verifiedAt),
        verifiedAt: r.verifiedAt,
        branch: r.branch,
        commitHash: r.commitSha,
        artifactCount: s.artifactCount ?? 0,
        driftCount: r.driftCount,
        bySeverity: r.bySeverity as VerifyHistoryEntry['bySeverity'],
      };
    });
    return { runs };
  }

  // History is derived from is_baseline snapshots — nothing to append.
  async appendVerifyHistory(): Promise<void> {}

  async deleteVerifyRun(): Promise<boolean> {
    return false;
  }

  // Diffs are computed on read from two snapshots; none is stored.
  async readVerifyDiff(): Promise<VerifyDiff | null> {
    return null;
  }

  async writeVerifyDiff(): Promise<void> {}

  async deleteVerifyDiff(): Promise<void> {}
}

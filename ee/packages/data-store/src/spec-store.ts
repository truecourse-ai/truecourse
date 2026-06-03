/**
 * Postgres implementation of core's `SpecStore`. The two spec documents
 * (`claims`, `decisions`) are small JSON queried whole, so they live inline as
 * `jsonb` in `spec_sets`, keyed by `(repo, commit, artifact)`. No blob.
 */

import { and, desc, eq } from 'drizzle-orm';
import { specSets, type EeDb } from '@truecourse/ee-db';
import type { RepoRef, SpecArtifact, SpecStore } from '@truecourse/core/lib/spec-store';

/**
 * `decisions` are the user's accumulated conflict resolutions — a single
 * per-repo "current" document, NOT a per-commit snapshot. We store them under a
 * fixed sentinel commit so the dashboard edit and any generation read the same
 * row. `claims`/`scanState` are per-commit (derived from the spec at a commit).
 */
const REPO_DECISIONS_COMMIT = '_repo';

function commitFor(ref: RepoRef, artifact: SpecArtifact): string {
  return artifact === 'decisions' ? REPO_DECISIONS_COMMIT : ref.commitSha;
}

export class PgSpecStore implements SpecStore {
  readonly materializesInPlace = false;

  constructor(private readonly db: EeDb) {}

  async saveSpec(ref: RepoRef, artifact: SpecArtifact, json: unknown): Promise<void> {
    const commitSha = commitFor(ref, artifact);
    if (!commitSha) {
      throw new Error('[ee-data-store] saveSpec requires a non-empty commit SHA');
    }
    const now = new Date().toISOString();
    await this.db
      .insert(specSets)
      .values({ repoKey: ref.repoKey, commitSha, artifact, payload: json, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [specSets.repoKey, specSets.commitSha, specSets.artifact],
        set: { payload: json, updatedAt: now },
      });
  }

  async loadSpec<T = unknown>(ref: RepoRef, artifact: SpecArtifact): Promise<T | null> {
    const rows = await this.db
      .select({ payload: specSets.payload })
      .from(specSets)
      .where(
        and(
          eq(specSets.repoKey, ref.repoKey),
          eq(specSets.commitSha, commitFor(ref, artifact)),
          eq(specSets.artifact, artifact),
        ),
      )
      .limit(1);
    return rows[0] ? (rows[0].payload as T) : null;
  }

  async loadLatest<T = unknown>(repoKey: string, artifact: SpecArtifact): Promise<T | null> {
    const rows = await this.db
      .select({ payload: specSets.payload })
      .from(specSets)
      .where(and(eq(specSets.repoKey, repoKey), eq(specSets.artifact, artifact)))
      .orderBy(desc(specSets.createdAt))
      .limit(1);
    return rows[0] ? (rows[0].payload as T) : null;
  }
}

/**
 * Postgres implementation of core's `SpecStore`. Routes each artifact to its
 * proper home:
 *   - immutable per-commit artifacts (claims / scanState / rawClaims / chains)
 *     → content-addressed in `content`, with a `spec_sets` manifest row pointing
 *       in by sha (deduped: an unchanged artifact across commits is stored once);
 *   - decisions → the per-scope `decisions` ledger (mutable, always-latest, NOT
 *     per-commit — the core's `_repo` sentinel commit is ignored here);
 *   - verifyState → `verify_snapshots` (per-commit verify state is not a spec).
 */

import { and, desc, eq } from 'drizzle-orm';
import {
  specSets,
  workspaceSpecSets,
  decisions,
  verifySnapshots,
  type EeDb,
} from '@truecourse/ee-db';
import type {
  RepoRef,
  WorkspaceRef,
  SpecArtifact,
  SpecStore,
} from '@truecourse/core/lib/spec-store';
import { ContentStore, contentScope } from './content-store.js';
import { writeSnapshot, readSnapshot } from './snapshots.js';

function requireCommit(ref: RepoRef): string {
  if (!ref.commitSha) {
    throw new Error('[ee-data-store] saveSpec requires a non-empty commit SHA');
  }
  return ref.commitSha;
}

export class PgSpecStore implements SpecStore {
  readonly materializesInPlace = false;
  private readonly content: ContentStore;

  constructor(private readonly db: EeDb) {
    this.content = new ContentStore(db);
  }

  async saveSpec(ref: RepoRef, artifact: SpecArtifact, json: unknown): Promise<void> {
    if (artifact === 'verifyState') {
      await writeSnapshot(this.db, ref.repoKey, requireCommit(ref), json as { drifts?: [] });
      return;
    }
    if (artifact === 'decisions') {
      await this.saveDecisions(ref.repoKey, json);
      return;
    }
    const commitSha = requireCommit(ref);
    const sha = await this.content.putText(contentScope.spec(ref.repoKey), JSON.stringify(json));
    const now = new Date().toISOString();
    await this.db
      .insert(specSets)
      .values({ repoKey: ref.repoKey, commitSha, artifact, contentSha: sha, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [specSets.repoKey, specSets.commitSha, specSets.artifact],
        set: { contentSha: sha, updatedAt: now },
      });
  }

  async loadSpec<T = unknown>(ref: RepoRef, artifact: SpecArtifact): Promise<T | null> {
    if (artifact === 'verifyState') {
      return readSnapshot<T>(this.db, ref.repoKey, requireCommit(ref));
    }
    if (artifact === 'decisions') {
      return this.loadDecisions<T>(ref.repoKey);
    }
    const rows = await this.db
      .select({ contentSha: specSets.contentSha })
      .from(specSets)
      .where(
        and(
          eq(specSets.repoKey, ref.repoKey),
          eq(specSets.commitSha, ref.commitSha),
          eq(specSets.artifact, artifact),
        ),
      )
      .limit(1);
    if (!rows[0]) return null;
    return this.content.getJson<T>(contentScope.spec(ref.repoKey), rows[0].contentSha);
  }

  async loadLatest<T = unknown>(repoKey: string, artifact: SpecArtifact): Promise<T | null> {
    if (artifact === 'decisions') {
      return this.loadDecisions<T>(repoKey);
    }
    if (artifact === 'verifyState') {
      const rows = await this.db
        .select({ snapshot: verifySnapshots.snapshot })
        .from(verifySnapshots)
        .where(eq(verifySnapshots.repoKey, repoKey))
        .orderBy(desc(verifySnapshots.verifiedAt))
        .limit(1);
      return rows[0] ? (rows[0].snapshot as T) : null;
    }
    const rows = await this.db
      .select({ contentSha: specSets.contentSha })
      .from(specSets)
      .where(and(eq(specSets.repoKey, repoKey), eq(specSets.artifact, artifact)))
      .orderBy(desc(specSets.createdAt))
      .limit(1);
    if (!rows[0]) return null;
    return this.content.getJson<T>(contentScope.spec(repoKey), rows[0].contentSha);
  }

  // The commit of the latest stored `rawClaims` — i.e. the commit a body-free
  // re-merge reads from, so a decision-driven contract regen writes back to the
  // SAME commit (keeping the dashboard-latest and the gate's per-commit lookup
  // consistent).
  async latestCommit(repoKey: string): Promise<string | null> {
    const rows = await this.db
      .select({ commitSha: specSets.commitSha })
      .from(specSets)
      .where(and(eq(specSets.repoKey, repoKey), eq(specSets.artifact, 'rawClaims')))
      .orderBy(desc(specSets.createdAt))
      .limit(1);
    return rows[0]?.commitSha ?? null;
  }

  // --- Workspace scope (always-latest, keyed by org, no commit) -------------

  async saveWorkspaceSpec(ref: WorkspaceRef, artifact: SpecArtifact, json: unknown): Promise<void> {
    if (artifact === 'verifyState') {
      throw new Error('[ee-data-store] verifyState is repo-scoped only');
    }
    if (artifact === 'decisions') {
      await this.saveDecisions(`ws:${ref.workspaceOrgId}`, json);
      return;
    }
    const sha = await this.content.putText(
      contentScope.workspaceSpec(ref.workspaceOrgId),
      JSON.stringify(json),
    );
    const now = new Date().toISOString();
    await this.db
      .insert(workspaceSpecSets)
      .values({ workspaceOrgId: ref.workspaceOrgId, artifact, contentSha: sha, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [workspaceSpecSets.workspaceOrgId, workspaceSpecSets.artifact],
        set: { contentSha: sha, updatedAt: now },
      });
  }

  async loadWorkspaceSpec<T = unknown>(ref: WorkspaceRef, artifact: SpecArtifact): Promise<T | null> {
    if (artifact === 'decisions') {
      return this.loadDecisions<T>(`ws:${ref.workspaceOrgId}`);
    }
    const rows = await this.db
      .select({ contentSha: workspaceSpecSets.contentSha })
      .from(workspaceSpecSets)
      .where(
        and(
          eq(workspaceSpecSets.workspaceOrgId, ref.workspaceOrgId),
          eq(workspaceSpecSets.artifact, artifact),
        ),
      )
      .limit(1);
    if (!rows[0]) return null;
    return this.content.getJson<T>(contentScope.workspaceSpec(ref.workspaceOrgId), rows[0].contentSha);
  }

  // --- decisions ledger (per scope: a repo key, or `ws:<org>`) --------------

  private async saveDecisions(scope: string, json: unknown): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(decisions)
      .values({ scope, payload: json, updatedAt: now })
      .onConflictDoUpdate({ target: [decisions.scope], set: { payload: json, updatedAt: now } });
  }

  private async loadDecisions<T>(scope: string): Promise<T | null> {
    const rows = await this.db
      .select({ payload: decisions.payload })
      .from(decisions)
      .where(eq(decisions.scope, scope))
      .limit(1);
    return rows[0] ? (rows[0].payload as T) : null;
  }
}

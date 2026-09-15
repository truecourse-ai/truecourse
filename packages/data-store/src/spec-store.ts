/**
 * Postgres implementation of core's `SpecStore`. Routes each artifact to its
 * proper home:
 *   - the workspace's corpus and the docs snapshot manifest → content-addressed
 *     in `content`, with a `workspace_spec_sets` row pointing in by sha; the
 *     document bodies the snapshot points at live in the same scope, one object
 *     per distinct body;
 *   - decisions → the per-scope `decisions` ledger (mutable, always-latest).
 */

import { and, eq } from 'drizzle-orm';
import { workspaceSpecSets, decisions, type Db } from '@truecourse/db';
import type {
  WorkspaceRef,
  SpecArtifact,
  SpecStore,
} from '@truecourse/core/lib/spec-store';
import { ContentStore, contentScope } from './content-store.js';

/** The `docs` artifact: the scan's document snapshot, bodies by content sha. */
interface SpecDocsManifest {
  v: 1;
  files: Record<string, string>;
}

export class PgSpecStore implements SpecStore {
  private readonly content: ContentStore;

  constructor(private readonly db: Db) {
    this.content = new ContentStore(db);
  }

  // --- Workspace scope (always-latest, keyed by org, no commit) -------------

  async saveWorkspaceSpec(ref: WorkspaceRef, artifact: SpecArtifact, json: unknown): Promise<void> {
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

  /** The workspace scan's document snapshot: bodies once per workspace by sha,
   *  the manifest as the workspace's `docs` artifact. */
  async saveWorkspaceSpecDocs(ref: WorkspaceRef, files: Record<string, string>): Promise<void> {
    const scope = contentScope.workspaceSpec(ref.workspaceOrgId);
    const manifest: Record<string, string> = {};
    for (const [docRef, body] of Object.entries(files)) {
      manifest[docRef] = await this.content.putText(scope, body);
    }
    await this.saveWorkspaceSpec(ref, 'docs', { v: 1, files: manifest });
  }

  async loadWorkspaceSpecDoc(workspaceOrgId: string, docRef: string): Promise<string | null> {
    const manifest = await this.loadWorkspaceSpec<SpecDocsManifest>(
      { workspaceOrgId },
      'docs',
    );
    const sha = manifest?.files?.[docRef];
    if (!sha) return null;
    return this.content.get(contentScope.workspaceSpec(workspaceOrgId), sha);
  }

  // --- decisions ledger (scope: `ws:<org>`) ---------------------------------

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

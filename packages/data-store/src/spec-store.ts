/**
 * Postgres implementation of core's `SpecStore`. Routes each artifact to its
 * proper home:
 *   - the workspace's corpus and the docs snapshot manifest → content-addressed
 *     in `content`, with a `workspace_spec_sets` VERSION row per save pointing
 *     in by sha (the current one is the scope's newest); the document bodies
 *     the snapshot points at live in the same scope, one object per distinct
 *     body;
 *   - decisions → the per-scope `decisions` ledger (mutable, always-latest).
 *
 * Every save of a series applies retention to it and sweeps the workspace's
 * pool of what no surviving version references.
 */

import { and, desc, eq } from 'drizzle-orm';
import { workspaceSpecSets, decisions, type Db } from '@truecourse/db';
import { DEFAULT_VERSION_SCOPE, type WorkspaceSpecVersion, type WorkspaceSpecVersionArtifact } from '@truecourse/shared';
import type {
  WorkspaceRef,
  WorkspaceSpecAt,
  WorkspaceSpecProvenance,
  SpecArtifact,
  SpecStore,
} from '@truecourse/core/lib/spec-store';
import { ContentStore, contentScope } from './content-store.js';
import { iso } from './iso.js';
import { newVersionId, sweepWorkspaceSeries } from './version-sweep.js';

/** The `docs` artifact: the scan's document snapshot, bodies by content sha. */
interface SpecDocsManifest {
  v: 1;
  files: Record<string, string>;
}

const scopeOf = (ref: Pick<WorkspaceRef, 'scope'> | undefined): string =>
  ref?.scope ?? DEFAULT_VERSION_SCOPE;

export class PgSpecStore implements SpecStore {
  private readonly content: ContentStore;

  constructor(private readonly db: Db) {
    this.content = new ContentStore(db);
  }

  // --- Workspace scope -----------------------------------------------------

  async saveWorkspaceSpec(
    ref: WorkspaceRef,
    artifact: SpecArtifact,
    json: unknown,
    provenance: WorkspaceSpecProvenance = {},
  ): Promise<void> {
    if (artifact === 'decisions') {
      await this.saveDecisions(`ws:${ref.workspaceOrgId}`, json);
      return;
    }
    const sha = await this.content.putText(
      contentScope.workspaceSpec(ref.workspaceOrgId),
      JSON.stringify(json),
    );
    const now = new Date();
    await this.db.insert(workspaceSpecSets).values({
      id: newVersionId(now),
      workspaceOrgId: ref.workspaceOrgId,
      artifact,
      contentSha: sha,
      scope: scopeOf(ref),
      producedByRun: provenance.producedByRun ?? null,
      model: provenance.model ?? null,
      sourceCommit: provenance.sourceCommit ?? null,
      createdAt: now.toISOString(),
    });
    await sweepWorkspaceSeries(this.db, ref.workspaceOrgId, scopeOf(ref), artifact);
  }

  async loadWorkspaceSpec<T = unknown>(
    ref: WorkspaceRef,
    artifact: SpecArtifact,
    at: WorkspaceSpecAt = {},
  ): Promise<T | null> {
    if (artifact === 'decisions') {
      return this.loadDecisions<T>(`ws:${ref.workspaceOrgId}`);
    }
    const sha = await this.versionSha(ref, artifact, at);
    if (!sha) return null;
    return this.content.getJson<T>(contentScope.workspaceSpec(ref.workspaceOrgId), sha);
  }

  /** The content sha of the version `at` names — one by id, else the scope's newest. */
  private async versionSha(
    ref: WorkspaceRef,
    artifact: SpecArtifact,
    at: WorkspaceSpecAt,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ contentSha: workspaceSpecSets.contentSha })
      .from(workspaceSpecSets)
      .where(
        at.id
          ? and(
              eq(workspaceSpecSets.workspaceOrgId, ref.workspaceOrgId),
              eq(workspaceSpecSets.artifact, artifact),
              eq(workspaceSpecSets.id, at.id),
            )
          : and(
              eq(workspaceSpecSets.workspaceOrgId, ref.workspaceOrgId),
              eq(workspaceSpecSets.artifact, artifact),
              eq(workspaceSpecSets.scope, scopeOf(ref)),
            ),
      )
      .orderBy(desc(workspaceSpecSets.createdAt), desc(workspaceSpecSets.id))
      .limit(1);
    return rows[0]?.contentSha ?? null;
  }

  /** The workspace scan's document snapshot: bodies once per workspace by sha,
   *  the manifest as a new version of the workspace's `docs` series. */
  async saveWorkspaceSpecDocs(
    ref: WorkspaceRef,
    files: Record<string, string>,
    provenance?: WorkspaceSpecProvenance,
  ): Promise<void> {
    const scope = contentScope.workspaceSpec(ref.workspaceOrgId);
    const manifest: Record<string, string> = {};
    for (const [docRef, body] of Object.entries(files)) {
      manifest[docRef] = await this.content.putText(scope, body);
    }
    await this.saveWorkspaceSpec(ref, 'docs', { v: 1, files: manifest }, provenance);
  }

  async loadWorkspaceSpecDoc(
    workspaceOrgId: string,
    docRef: string,
    ref: Pick<WorkspaceRef, 'scope'> & WorkspaceSpecAt = {},
  ): Promise<string | null> {
    const manifest = await this.loadWorkspaceSpec<SpecDocsManifest>(
      { workspaceOrgId, ...(ref.scope ? { scope: ref.scope } : {}) },
      'docs',
      ref.id ? { id: ref.id } : {},
    );
    const sha = manifest?.files?.[docRef];
    if (!sha) return null;
    return this.content.get(contentScope.workspaceSpec(workspaceOrgId), sha);
  }

  async listWorkspaceSpecVersions(
    ref: WorkspaceRef,
    artifact: WorkspaceSpecVersionArtifact,
    opts: { limit?: number } = {},
  ): Promise<WorkspaceSpecVersion[]> {
    const rows = await this.db
      .select({
        id: workspaceSpecSets.id,
        scope: workspaceSpecSets.scope,
        producedByRun: workspaceSpecSets.producedByRun,
        model: workspaceSpecSets.model,
        sourceCommit: workspaceSpecSets.sourceCommit,
        createdAt: workspaceSpecSets.createdAt,
      })
      .from(workspaceSpecSets)
      .where(
        and(
          eq(workspaceSpecSets.workspaceOrgId, ref.workspaceOrgId),
          eq(workspaceSpecSets.artifact, artifact),
          eq(workspaceSpecSets.scope, scopeOf(ref)),
        ),
      )
      .orderBy(desc(workspaceSpecSets.createdAt), desc(workspaceSpecSets.id))
      .limit(opts.limit ?? 50);
    return rows.map((row) => ({ ...row, artifact, createdAt: iso(row.createdAt) }));
  }

  async readWorkspaceSpecVersion(
    workspaceOrgId: string,
    artifact: WorkspaceSpecVersionArtifact,
    versionId: string,
  ): Promise<WorkspaceSpecVersion | null> {
    const [row] = await this.db
      .select({
        id: workspaceSpecSets.id,
        scope: workspaceSpecSets.scope,
        producedByRun: workspaceSpecSets.producedByRun,
        model: workspaceSpecSets.model,
        sourceCommit: workspaceSpecSets.sourceCommit,
        createdAt: workspaceSpecSets.createdAt,
      })
      .from(workspaceSpecSets)
      .where(
        and(
          eq(workspaceSpecSets.workspaceOrgId, workspaceOrgId),
          eq(workspaceSpecSets.artifact, artifact),
          eq(workspaceSpecSets.id, versionId),
        ),
      )
      .limit(1);
    return row ? { ...row, artifact, createdAt: iso(row.createdAt) } : null;
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

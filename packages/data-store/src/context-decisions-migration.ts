/**
 * Fold every connected repository's stored DECISIONS into its workspace's, at
 * boot, once the sources exist.
 *
 * The rules and the re-subjecting live in core (`services/context/decisions-fold`,
 * beside the ref grammar they follow); what lives here is the SQL half — which
 * repositories a workspace has, which workspace source is a repository's own,
 * which workspace site source an old registry id became, and the one decisions
 * row per workspace that comes out.
 *
 * Idempotent: every row is keyed by its own subject, so a second boot rewrites
 * the same document. Nothing is deleted from the repositories' own decisions —
 * slice 4 retires those rows.
 */

import { eq } from 'drizzle-orm';
import {
  contextSources,
  decisions as decisionsTable,
  ghRepos,
  specSources,
  type Db,
} from '@truecourse/db';
import { log } from '@truecourse/core/lib/logger';
import { foldRepoDecisions, type DecisionsFoldInput } from '@truecourse/core/services/context';
import {
  DecisionsFileSchema,
  SourcesFileSchema,
  type DecisionsFile,
} from '@truecourse/spec-consolidator';
import type { RepositorySourceConfig, SiteSourceConfig } from '@truecourse/shared';

export interface DecisionsMigrationSummary {
  /** Workspaces whose decisions document was written. */
  workspaces: number;
  /** Rows folded in, across every kind. */
  folded: number;
  /** Rows whose subject could not be mapped to the new grammar. */
  dropped: number;
}

/** The one call boot makes, after `migrateWorkspaceContext`. Safe to re-run. */
export async function migrateWorkspaceDecisions(db: Db): Promise<DecisionsMigrationSummary> {
  const summary: DecisionsMigrationSummary = { workspaces: 0, folded: 0, dropped: 0 };
  const repos = await db
    .select({ repoFullName: ghRepos.repoFullName, workspaceOrgId: ghRepos.workspaceOrgId })
    .from(ghRepos);
  if (repos.length === 0) return summary;

  const byOrg = new Map<string, string[]>();
  for (const repo of repos) {
    if (!repo.workspaceOrgId) continue;
    byOrg.set(repo.workspaceOrgId, [...(byOrg.get(repo.workspaceOrgId) ?? []), repo.repoFullName]);
  }

  for (const [org, repoNames] of [...byOrg.entries()].sort()) {
    if (await foldWorkspace(db, org, repoNames.sort(), summary)) summary.workspaces += 1;
  }
  if (summary.folded > 0 || summary.dropped > 0) {
    log.info(
      `[context] decisions migration: ${summary.folded} row(s) folded into ` +
        `${summary.workspaces} workspace(s), ${summary.dropped} dropped`,
    );
  }
  return summary;
}

async function foldWorkspace(
  db: Db,
  org: string,
  repoNames: readonly string[],
  summary: DecisionsMigrationSummary,
): Promise<boolean> {
  const sources = await db
    .select({ id: contextSources.id, kind: contextSources.kind, config: contextSources.config })
    .from(contextSources)
    .where(eq(contextSources.workspaceOrgId, org));
  if (sources.length === 0) return false;

  let workspace = await readDecisions(db, `ws:${org}`);
  let changed = false;

  for (const repoFullName of repoNames) {
    const stored = await readDecisions(db, repoFullName);
    if (!stored) continue;
    const input = await foldInput(db, sources, repoFullName);
    if (!input) {
      log.warn(`[context] ${repoFullName}: no Repository source — its decisions are not migrated`);
      continue;
    }
    const result = foldRepoDecisions(workspace, stored, input);
    workspace = result.decisions;
    changed = changed || result.changed;
    summary.folded += result.folded;
    summary.dropped += result.dropped.length;
    for (const row of result.dropped) {
      log.info(`[context] ${repoFullName}: dropped a ${row.kind} for "${row.subject}" — ${row.reason}`);
    }
    for (const note of result.settled) {
      log.info(
        `[context] ${repoFullName}: two repositories disagreed on ${note.subject} — ` +
          `"${note.kept}" stands, "${note.dropped}" dropped`,
      );
    }
  }

  if (!changed || !workspace) return false;
  await writeDecisionsRow(db, `ws:${org}`, workspace);
  return true;
}

/** Which source is this repository's own, and which site each old id became. */
async function foldInput(
  db: Db,
  sources: ReadonlyArray<{ id: string; kind: string; config: unknown }>,
  repoFullName: string,
): Promise<DecisionsFoldInput | null> {
  const repoSource = sources.find(
    (source) =>
      source.kind === 'repository' &&
      (source.config as RepositorySourceConfig)?.repoFullName === repoFullName,
  );
  if (!repoSource) return null;

  // The old per-repository registry named its sites by ids of its own; the
  // workspace's site sources are the same sites by llms.txt URL, so that URL is
  // what maps one id onto the other.
  const siteByUrl = new Map<string, string>();
  for (const source of sources) {
    if (source.kind !== 'site') continue;
    const url = (source.config as SiteSourceConfig)?.llmsTxtUrl;
    if (url) siteByUrl.set(url, source.id);
  }
  const siteSourceIds = new Map<string, string>();
  const rows = await db
    .select({ registry: specSources.registry })
    .from(specSources)
    .where(eq(specSources.repoKey, repoFullName))
    .limit(1);
  const parsed = rows[0] ? SourcesFileSchema.safeParse(rows[0].registry) : null;
  if (parsed?.success) {
    for (const old of parsed.data.sources) {
      const next = siteByUrl.get(old.llmsTxtUrl);
      if (next) siteSourceIds.set(old.id, next);
    }
  }
  return { repositorySourceId: repoSource.id, siteSourceIds, repoFullName };
}

async function readDecisions(db: Db, scope: string): Promise<DecisionsFile | null> {
  const rows = await db
    .select({ payload: decisionsTable.payload })
    .from(decisionsTable)
    .where(eq(decisionsTable.scope, scope))
    .limit(1);
  if (!rows[0]) return null;
  const parsed = DecisionsFileSchema.safeParse(rows[0].payload);
  if (!parsed.success) {
    log.warn(`[context] decisions for "${scope}" do not parse — not migrated`);
    return null;
  }
  return parsed.data;
}

async function writeDecisionsRow(db: Db, scope: string, value: DecisionsFile): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(decisionsTable)
    .values({ scope, payload: value, updatedAt: now })
    .onConflictDoUpdate({ target: [decisionsTable.scope], set: { payload: value, updatedAt: now } });
}

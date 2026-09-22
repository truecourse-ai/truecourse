/**
 * Retention over the versioned series and the content pool behind them.
 *
 * A series (a repository's scenario sets, generate reports or setup bundles; a
 * workspace's corpora or document snapshots) is trimmed to
 * {@link VERSION_RETENTION}, and the pool the surviving versions point into is
 * swept of every body nothing references any more — where "references" is
 * every surviving manifest, every corpus body, every document a snapshot
 * names, and every run's and report's evidence. Runs are never trimmed.
 *
 * A save trims the ONE series it just extended and sweeps the owner's pools
 * only when that trim took a version — nothing else can have orphaned a body
 * (runs are never trimmed, and a purge sweeps for itself), so the full pass
 * over every series and every manifest is boot's ({@link sweepStoredVersions})
 * and not the price of every save.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  guardResults,
  guardRuns,
  guardScenarioSets,
  guardSetupSets,
  workspaceSpecSets,
  type Db,
} from '@truecourse/db';
import { ContentStore, contentScope } from './content-store.js';
import { VERSION_RETENTION, retentionCutoff, sweepCutoff } from './retention.js';

/** A version id: time-sortable, and a plain segment so it can name a route. */
export function newVersionId(now: Date = new Date()): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}`;
}

/** The manifest shape a scenario set, a setup bundle and a docs snapshot share. */
interface FileManifest {
  v: number;
  files: Record<string, string>;
}

type GuardSeriesTable = typeof guardResults | typeof guardScenarioSets | typeof guardSetupSets;

/** What a sweep took: versions trimmed and bodies deleted, by pool. */
export interface SweepCounts {
  versions: number;
  bodies: Record<string, number>;
}

/**
 * Delete the versions of one series that retention no longer keeps: those
 * beyond the newest `keep` AND older than the cutoff. Returns how many went.
 */
async function trimIds(
  db: Db,
  table: PgTable & { id: AnyPgColumn; createdAt: AnyPgColumn },
  idsNewestFirst: string[],
): Promise<number> {
  const beyondKeep = idsNewestFirst.slice(VERSION_RETENTION.keep);
  if (beyondKeep.length === 0) return 0;
  const gone = await db
    .delete(table)
    .where(and(inArray(table.id, beyondKeep), lt(table.createdAt, retentionCutoff())))
    .returning({ id: table.id });
  return gone.length;
}

/** Trim one repository series (table, scope). */
export async function trimGuardSeries(
  db: Db,
  table: GuardSeriesTable,
  repoKey: string,
  scope: string,
): Promise<number> {
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.repoKey, repoKey), eq(table.scope, scope)))
    .orderBy(desc(table.createdAt), desc(table.id));
  return trimIds(db, table, rows.map((r) => r.id));
}

/** Trim one workspace series (scope, artifact). */
export async function trimWorkspaceSeries(
  db: Db,
  workspaceOrgId: string,
  scope: string,
  artifact: string,
): Promise<number> {
  const rows = await db
    .select({ id: workspaceSpecSets.id })
    .from(workspaceSpecSets)
    .where(
      and(
        eq(workspaceSpecSets.workspaceOrgId, workspaceOrgId),
        eq(workspaceSpecSets.scope, scope),
        eq(workspaceSpecSets.artifact, artifact),
      ),
    )
    .orderBy(desc(workspaceSpecSets.createdAt), desc(workspaceSpecSets.id));
  return trimIds(db, workspaceSpecSets, rows.map((r) => r.id));
}

/**
 * Sweep a repository's two pools against what its surviving versions and its
 * runs still reference: the scenario-set and setup-bundle manifests point into
 * `guard:`, the run and report evidence manifests into `guard-evidence:`.
 */
export async function sweepRepoContent(db: Db, repoKey: string): Promise<Record<string, number>> {
  const live = new Set<string>();
  for (const table of [guardScenarioSets, guardSetupSets]) {
    const rows = await db
      .select({ manifest: table.manifest })
      .from(table)
      .where(eq(table.repoKey, repoKey));
    for (const row of rows) {
      for (const sha of Object.values((row.manifest as FileManifest).files ?? {})) live.add(sha);
    }
  }
  const evidence = new Set<string>();
  for (const table of [guardRuns, guardResults]) {
    const rows = await db
      .select({ evidence: table.evidence })
      .from(table)
      .where(eq(table.repoKey, repoKey));
    for (const row of rows) {
      for (const sha of Object.values((row.evidence as Record<string, string> | null) ?? {})) {
        evidence.add(sha);
      }
    }
  }
  const content = new ContentStore(db);
  const before = sweepCutoff();
  return {
    guard: await content.gc(contentScope.guard(repoKey), live, before),
    evidence: await content.gc(contentScope.guardEvidence(repoKey), evidence, before),
  };
}

/**
 * Sweep a workspace's spec pool against its surviving versions: every corpus
 * body, every docs manifest, and every document body a surviving snapshot names.
 */
export async function sweepWorkspaceContent(
  db: Db,
  workspaceOrgId: string,
): Promise<Record<string, number>> {
  const scope = contentScope.workspaceSpec(workspaceOrgId);
  const content = new ContentStore(db);
  const rows = await db
    .select({ artifact: workspaceSpecSets.artifact, contentSha: workspaceSpecSets.contentSha })
    .from(workspaceSpecSets)
    .where(eq(workspaceSpecSets.workspaceOrgId, workspaceOrgId));
  const live = new Set<string>();
  for (const row of rows) {
    live.add(row.contentSha);
    if (row.artifact !== 'docs') continue;
    const manifest = await content.getJson<FileManifest>(scope, row.contentSha);
    for (const sha of Object.values(manifest?.files ?? {})) live.add(sha);
  }
  return { spec: await content.gc(scope, live, sweepCutoff()) };
}

/** What a save does after its row lands: trim its series, sweep the pools if that took anything. */
export async function sweepGuardSeries(
  db: Db,
  table: GuardSeriesTable,
  repoKey: string,
  scope: string,
): Promise<SweepCounts> {
  const versions = await trimGuardSeries(db, table, repoKey, scope);
  return { versions, bodies: versions > 0 ? await sweepRepoContent(db, repoKey) : {} };
}

/** The workspace form of {@link sweepGuardSeries}. */
export async function sweepWorkspaceSeries(
  db: Db,
  workspaceOrgId: string,
  scope: string,
  artifact: string,
): Promise<SweepCounts> {
  const versions = await trimWorkspaceSeries(db, workspaceOrgId, scope, artifact);
  return { versions, bodies: versions > 0 ? await sweepWorkspaceContent(db, workspaceOrgId) : {} };
}

/** Trim every series of one repository, then sweep its pools. */
export async function sweepRepoVersions(db: Db, repoKey: string): Promise<SweepCounts> {
  let versions = 0;
  for (const table of [guardResults, guardScenarioSets, guardSetupSets]) {
    const scopes = await db
      .selectDistinct({ scope: table.scope })
      .from(table)
      .where(eq(table.repoKey, repoKey));
    for (const { scope } of scopes) versions += await trimGuardSeries(db, table, repoKey, scope);
  }
  return { versions, bodies: await sweepRepoContent(db, repoKey) };
}

/** Trim every series of one workspace, then sweep its pool. */
export async function sweepWorkspaceVersions(db: Db, workspaceOrgId: string): Promise<SweepCounts> {
  let versions = 0;
  const series = await db
    .selectDistinct({ scope: workspaceSpecSets.scope, artifact: workspaceSpecSets.artifact })
    .from(workspaceSpecSets)
    .where(eq(workspaceSpecSets.workspaceOrgId, workspaceOrgId));
  for (const { scope, artifact } of series) {
    versions += await trimWorkspaceSeries(db, workspaceOrgId, scope, artifact);
  }
  return { versions, bodies: await sweepWorkspaceContent(db, workspaceOrgId) };
}

/**
 * Everything: every repository with a series and every workspace with one.
 * What boot runs, so the orphans an earlier deployment left behind go too.
 */
export async function sweepStoredVersions(db: Db): Promise<SweepCounts> {
  const repos = new Set<string>();
  for (const table of [guardResults, guardScenarioSets, guardSetupSets]) {
    for (const row of await db.selectDistinct({ repoKey: table.repoKey }).from(table)) {
      repos.add(row.repoKey);
    }
  }
  const total: SweepCounts = { versions: 0, bodies: {} };
  const fold = (counts: SweepCounts): void => {
    total.versions += counts.versions;
    for (const [pool, n] of Object.entries(counts.bodies)) {
      total.bodies[pool] = (total.bodies[pool] ?? 0) + n;
    }
  };
  for (const repoKey of repos) fold(await sweepRepoVersions(db, repoKey));
  const orgs = await db
    .selectDistinct({ workspaceOrgId: workspaceSpecSets.workspaceOrgId })
    .from(workspaceSpecSets);
  for (const { workspaceOrgId } of orgs) fold(await sweepWorkspaceVersions(db, workspaceOrgId));
  return total;
}

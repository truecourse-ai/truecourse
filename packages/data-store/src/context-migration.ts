/**
 * Bring the workspaces that already exist into Context, at boot.
 *
 * Two moves, both idempotent — a second boot changes nothing:
 *
 *   1. Every CONNECTED repository (`gh_repos`) gets its Repository source, with
 *      the default patterns and the branch the link records, linked to itself.
 *      The source is created `never`: nothing has synced it yet, and the first
 *      push or a Sync now will.
 *   2. Every row of the old per-repository registry (`spec_sources`) becomes a
 *      site source of that repository's workspace, deduped by llms.txt URL
 *      within the workspace, linked to the repository that registered it. Its
 *      page bodies are copied from the old scope (`spec:<repoKey>`, keyed
 *      `sha256-<hash>`) into the workspace scope, and one ledger row per page
 *      is written with the hash the old registry already named — so a migrated
 *      site is readable before its first sync.
 *
 * Nothing is dropped: `spec_sources` keeps its rows, the per-repository routes
 * keep working, and the two live side by side until slice 4 retires the old
 * half. A page the old store never held a body for is skipped rather than
 * written as an empty document — the next sync fetches it.
 */

import { and, eq } from 'drizzle-orm';
import { contextBindings, contextDocuments, contextSources, ghRepos, specSources, type Db } from '@truecourse/db';
import {
  DEFAULT_REPOSITORY_EXCLUDE,
  DEFAULT_REPOSITORY_INCLUDE,
  type SiteSourceConfig,
} from '@truecourse/shared';
import { SourcesFileSchema } from '@truecourse/spec-consolidator';
import { repositorySourceId, siteSourceId } from '@truecourse/core/services/context';
import { log } from '@truecourse/core/lib/logger';
import { ContentStore, contentScope } from './content-store.js';
import { touchContextWorkspace } from './context-store.js';

export interface ContextMigrationSummary {
  /** Repository sources created (a repository that already had one is not counted). */
  repositorySources: number;
  /** Site sources created from the old per-repository registries. */
  siteSources: number;
  /** Ledger rows written for those sites' pages. */
  documents: number;
  /** Bindings created (a link that already existed is not counted). */
  bindings: number;
}

/** The one call boot makes. Safe to run on every start. */
export async function migrateWorkspaceContext(db: Db): Promise<ContextMigrationSummary> {
  const summary: ContextMigrationSummary = {
    repositorySources: 0,
    siteSources: 0,
    documents: 0,
    bindings: 0,
  };
  const repos = await db
    .select({
      repoFullName: ghRepos.repoFullName,
      workspaceOrgId: ghRepos.workspaceOrgId,
      defaultBranch: ghRepos.defaultBranch,
    })
    .from(ghRepos);
  if (repos.length === 0) return summary;

  const content = new ContentStore(db);
  const touched = new Set<string>();
  for (const repo of repos) {
    const org = repo.workspaceOrgId;
    if (!org) continue;
    const before = summary.bindings;
    await ensureRepositorySource(db, summary, org, repo.repoFullName, repo.defaultBranch ?? '');
    await migrateRegisteredSites(db, content, summary, org, repo.repoFullName);
    // A link made is a link change: the workspace's corpus (there is none yet
    // on a first migration, but a re-run on a scanned workspace is the case
    // that matters) must read as stale.
    if (summary.bindings > before) touched.add(org);
  }
  for (const org of touched) await touchContextWorkspace(db, org);
  if (summary.repositorySources + summary.siteSources + summary.bindings > 0) {
    log.info(
      `[context] migration: ${summary.repositorySources} repository source(s), ` +
        `${summary.siteSources} site source(s), ${summary.documents} document(s), ` +
        `${summary.bindings} link(s)`,
    );
  }
  return summary;
}

async function ensureRepositorySource(
  db: Db,
  summary: ContextMigrationSummary,
  org: string,
  repoFullName: string,
  defaultBranch: string,
): Promise<void> {
  const id = repositorySourceId(repoFullName);
  const now = new Date().toISOString();
  const inserted = await db
    .insert(contextSources)
    .values({
      workspaceOrgId: org,
      id,
      kind: 'repository',
      title: repoFullName,
      config: {
        repoFullName,
        include: [...DEFAULT_REPOSITORY_INCLUDE],
        exclude: [...DEFAULT_REPOSITORY_EXCLUDE],
        branch: defaultBranch,
      },
      status: 'never',
      statusNote: null,
      lastSyncAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: contextSources.id });
  if (inserted.length > 0) summary.repositorySources += 1;
  await ensureBinding(db, summary, org, repoFullName, id);
}

async function migrateRegisteredSites(
  db: Db,
  content: ContentStore,
  summary: ContextMigrationSummary,
  org: string,
  repoFullName: string,
): Promise<void> {
  const rows = await db
    .select({ registry: specSources.registry })
    .from(specSources)
    .where(eq(specSources.repoKey, repoFullName))
    .limit(1);
  if (!rows[0]) return;
  const parsed = SourcesFileSchema.safeParse(rows[0].registry);
  if (!parsed.success) {
    // A registry the schema no longer accepts is the old half's problem to
    // report; the migration must not fail the whole boot over one repository.
    log.warn(`[context] ${repoFullName}: unreadable spec_sources registry — not migrated`);
    return;
  }

  for (const source of parsed.data.sources) {
    const existingId = await findSiteByUrl(db, org, source.llmsTxtUrl);
    const sourceId = existingId ?? (await createSiteSource(db, summary, org, source.llmsTxtUrl, source.title, source.fetchedAt));
    await ensureBinding(db, summary, org, repoFullName, sourceId);
    if (existingId) continue; // its pages came across with the first repository

    for (const doc of source.docs) {
      const body = await content.get(contentScope.spec(repoFullName), `sha256-${doc.contentHash}`);
      // A page whose body the old store never held is left for the next sync to
      // fetch rather than written as an empty document.
      if (body === null) continue;
      await content.put(contentScope.context(org), `sha256-${doc.contentHash}`, body);
      const written = await db
        .insert(contextDocuments)
        .values({
          workspaceOrgId: org,
          sourceId,
          docId: doc.url,
          docPath: doc.path,
          title: doc.title,
          url: doc.url,
          contentHash: doc.contentHash,
          updatedAt: source.fetchedAt,
          createdAt: source.fetchedAt,
        })
        .onConflictDoNothing()
        .returning({ docId: contextDocuments.docId });
      if (written.length > 0) summary.documents += 1;
    }
  }
}

/** The workspace's site source for this llms.txt URL, if one already exists. */
async function findSiteByUrl(db: Db, org: string, llmsTxtUrl: string): Promise<string | null> {
  const rows = await db
    .select({ id: contextSources.id, config: contextSources.config })
    .from(contextSources)
    .where(and(eq(contextSources.workspaceOrgId, org), eq(contextSources.kind, 'site')));
  const match = rows.find((row) => (row.config as SiteSourceConfig)?.llmsTxtUrl === llmsTxtUrl);
  return match?.id ?? null;
}

async function createSiteSource(
  db: Db,
  summary: ContextMigrationSummary,
  org: string,
  llmsTxtUrl: string,
  title: string,
  fetchedAt: string,
): Promise<string> {
  const taken = new Set(
    (
      await db
        .select({ id: contextSources.id })
        .from(contextSources)
        .where(eq(contextSources.workspaceOrgId, org))
    ).map((row) => row.id),
  );
  const id = siteSourceId(llmsTxtUrl, taken);
  const now = new Date().toISOString();
  await db
    .insert(contextSources)
    .values({
      workspaceOrgId: org,
      id,
      kind: 'site',
      title: title || new URL(llmsTxtUrl).host,
      config: { llmsTxtUrl },
      // The pages came across with their bodies, so the source IS synced — as of
      // the fetch the old registry recorded, not as of this boot.
      status: 'synced',
      statusNote: null,
      lastSyncAt: fetchedAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  summary.siteSources += 1;
  return id;
}

async function ensureBinding(
  db: Db,
  summary: ContextMigrationSummary,
  org: string,
  repoFullName: string,
  sourceId: string,
): Promise<void> {
  const inserted = await db
    .insert(contextBindings)
    .values({ workspaceOrgId: org, repoFullName, sourceId, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .returning({ sourceId: contextBindings.sourceId });
  if (inserted.length > 0) summary.bindings += 1;
}

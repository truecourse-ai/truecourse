/**
 * Postgres implementation of core's `GuardStore`. Four homes, every one of
 * them a SERIES rather than a row that is overwritten:
 *
 *   - RUN STATE (`guard_runs`, one row per run id): `writeGuardLatest` and
 *     `writeGuardRun` insert a run under its scope (the default branch's unless
 *     the caller names another), and a run id already stored is updated in
 *     place — the adjudication fold re-writes a run with its verdicts, and its
 *     evidence manifest is kept. `readGuardLatest` is the scope's newest run
 *     by `ran_at`, the history is the scope's runs, and `readGuardRun(runId)`
 *     resolves any run ever stored: a rerun at a commit is a new row beside the
 *     old one, never over it.
 *
 *   - EVIDENCE — per-run transcripts, content-addressed in `content` (scope
 *     `guard-evidence:<repo>`); the run row's `evidence` jsonb is the
 *     `{ "<scenarioId>/<file>": sha }` manifest that points in. BIRTH findings run
 *     with `persist: false` (no run row), so their transcripts hang off the generate
 *     report (`guard_results.evidence`, same shape) instead — `readGuardEvidenceAt`
 *     falls back to it when the evidence path's runId matches no run row.
 *
 *   - SCENARIO SETS (`guard_scenario_sets`) — one VERSION per save: the
 *     `scenarios/` tree (yaml + recipe.json + manifest.json) is deduped into
 *     `content` (scope `guard:<repo>`) with a `{ relPath: sha }` manifest row
 *     carrying its scope, commit and provenance. A read names a version by id,
 *     or takes the newest of a scope at a commit, or the newest of the scope
 *     outright — which is the CURRENT set. The generate reports
 *     (`guard_results`) are a series of the same shape, and a report names the
 *     set it was written beside (`scenario_set_id`: the scope's newest set at
 *     its commit when it was stored, none for a blocked generate).
 *     `restoreGuardScenarioSet` makes an older set current again by inserting
 *     a copy of it AND of the report paired with it, each naming what it copied
 *     (`restored_from`), so the current set and the current report stay the
 *     pair a generate produced.
 *
 *   - SETUP BUNDLES (`guard_setup_sets`) — the same shape and the same content
 *     scope for what `guard setup` leaves behind (`guard/setup.json`, the findings
 *     ledger, the recipe, the dependency catalog + settle record, the seed script,
 *     the generated compose file). A hosted setup runs in an ephemeral clone, so
 *     this is what carries its per-step settle spine from commit to commit: the
 *     job materializes the newest bundle before running and saves the clone's
 *     result as a new version after.
 *
 *   - DECISIONS — the mutable `dismissedClaims` ledger reuses the generic
 *     `decisions` table under a `guard:<repo>` scope, one row per repository. An
 *     absent row reads as `EMPTY_GUARD_DECISIONS`, never null.
 *
 * "Newest" is by `created_at` (then id, which is time-sortable): a series is
 * ordered by when its versions were written. Every save applies retention to
 * the series it extended (`version-sweep.ts`), and sweeps the repository's
 * two pools when that took a version.
 *
 * The `repoPath` argument is the stable repo key, never an on-disk path.
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { and, asc, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import {
  guardRuns,
  guardResults,
  guardScenarioSets,
  guardSetupSets,
  decisions,
  type Db,
} from '@truecourse/db';
import {
  DEFAULT_VERSION_SCOPE,
  guardEvidenceVisual,
  type GuardVersion,
  type GuardVersionArtifact,
} from '@truecourse/shared';
import type {
  GuardHistoryReadOptions,
  GuardRunCoverage,
  GuardRunWriteOptions,
  GuardStore,
  GuardVersionListOptions,
  RepoRef,
  SaveScenariosResult,
  VersionAt,
  VersionProvenance,
  WrittenGuardRun,
} from '@truecourse/core/lib/guard-store';
import {
  GuardManifestSchema,
  EMPTY_GUARD_DECISIONS,
  guardHistoryEntryOf,
  type GuardDecisions,
  type GuardGenerateReport,
  type GuardHistory,
  type GuardHistoryEntry,
  type GuardLatest,
  type GuardManifest,
  type GuardRunFlowSummary,
  type GuardRunSectionSummary,
} from '@truecourse/shared';
import {
  loadScenarios as fileLoadScenarios,
  evidenceRelPath,
  sanitizeSegment,
  walkScenarioRelFiles,
  type LoadedScenarios,
} from '@truecourse/guard-runner';
import { ContentStore, contentScope } from './content-store.js';
import { iso } from './iso.js';
import { assertSafeRel, mapLimit, safeJoin, sha256, sortKeys } from './pack.js';
import { newVersionId, sweepGuardSeries } from './version-sweep.js';
import { WORK_TREE_DIR, scenariosDir } from '@truecourse/shared/work-tree';

const OBJECT_CONCURRENCY = 16;

/** Reject an empty commit on the per-commit writes. */
function requireCommit(ref: RepoRef, what: string): string {
  if (!ref.commitSha) {
    throw new Error(`[data-store] ${what} requires a non-empty commit SHA`);
  }
  return ref.commitSha;
}

const scopeOf = (ref: { scope?: string } | undefined): string => ref?.scope ?? DEFAULT_VERSION_SCOPE;

/** Run ids / evidence filenames / version ids — plain segments, no separators, no `..`. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** The repo-relative prefix guard scenario paths are listed / read under. */
const SCENARIOS_PREFIX = '.truecourse/scenarios/';

interface Manifest {
  v: number;
  files: Record<string, string>;
}

/** The two manifest series share one row shape. */
type ManifestTable = typeof guardScenarioSets | typeof guardSetupSets;

/** The three series a `GuardVersion` can describe. */
type VersionTable = typeof guardResults | ManifestTable;

const versionTable = (artifact: GuardVersionArtifact): VersionTable =>
  artifact === 'report' ? guardResults : artifact === 'scenarios' ? guardScenarioSets : guardSetupSets;

/**
 * The columns every version record is read from: the row's series and
 * provenance, its file count where the series has one, and what it restored
 * where the series can be rolled back.
 */
function versionColumns(table: VersionTable) {
  return {
    id: table.id,
    scope: table.scope,
    commitSha: table.commitSha,
    producedByRun: table.producedByRun,
    model: table.model,
    createdAt: table.createdAt,
    fileCount: 'fileCount' in table ? table.fileCount : sql<number | null>`null`,
    restoredFrom: 'restoredFrom' in table ? table.restoredFrom : sql<string | null>`null`,
  };
}

/** Evidence pointer prefix (`evidenceRelPath` shape): `.truecourse/guard/evidence/`. */
const EVIDENCE_PREFIX_SEGMENTS = [WORK_TREE_DIR, 'guard', 'evidence'];

/**
 * A repo-relative evidence dir (`.truecourse/guard/evidence/<runId>/<scenarioSeg>`)
 * taken apart, or null when it is not one — the read is confined to the evidence
 * root by construction, so a `../`-laced dir can never name anything.
 */
function parseEvidenceDir(evidenceDir: string): { runId: string; scenarioSeg: string } | null {
  const segs = evidenceDir.split('/');
  if (segs.length !== EVIDENCE_PREFIX_SEGMENTS.length + 2) return null;
  if (segs.slice(0, EVIDENCE_PREFIX_SEGMENTS.length).join('/') !== EVIDENCE_PREFIX_SEGMENTS.join('/')) {
    return null;
  }
  const [runId, scenarioSeg] = segs.slice(EVIDENCE_PREFIX_SEGMENTS.length) as [string, string];
  if (!SAFE_SEGMENT.test(runId) || !SAFE_SEGMENT.test(scenarioSeg)) return null;
  return { runId, scenarioSeg };
}

/** The repository's row in the generic `decisions` table. */
const decisionsScope = (repoKey: string): string => `guard:${repoKey}`;

/** A content manifest over `files` (rel → body), with its bodies deduped into the pool. */
async function packFiles(
  content: ContentStore,
  scope: string,
  files: Record<string, Buffer>,
): Promise<{ manifest: Manifest; manifestHash: string; fileCount: number }> {
  const manifest: Record<string, string> = {};
  const uniqueBytes = new Map<string, Buffer>();
  for (const [rel, bytes] of Object.entries(files)) {
    assertSafeRel(rel);
    const sha = sha256(bytes);
    manifest[rel] = sha;
    if (!uniqueBytes.has(sha)) uniqueBytes.set(sha, bytes);
  }
  await mapLimit([...uniqueBytes.keys()], OBJECT_CONCURRENCY, async (sha) => {
    await content.put(scope, sha, uniqueBytes.get(sha)!.toString('utf-8'));
  });
  const sortedFiles = sortKeys(manifest);
  return {
    manifest: { v: 1, files: sortedFiles },
    manifestHash: sha256(Buffer.from(JSON.stringify(sortedFiles))),
    fileCount: Object.keys(sortedFiles).length,
  };
}

export class PgGuardStore implements GuardStore {
  private readonly content: ContentStore;

  constructor(private readonly db: Db) {
    this.content = new ContentStore(db);
  }

  // --- Run state ------------------------------------------------------------

  async readGuardLatest(repoKey: string, scope: string = DEFAULT_VERSION_SCOPE): Promise<GuardLatest | null> {
    const rows = await this.db
      .select({ snapshot: guardRuns.snapshot })
      .from(guardRuns)
      .where(and(eq(guardRuns.repoKey, repoKey), eq(guardRuns.scope, scope)))
      .orderBy(desc(guardRuns.ranAt), desc(guardRuns.runId))
      .limit(1);
    return rows[0] ? (rows[0].snapshot as GuardLatest) : null;
  }

  async writeGuardLatest(repoKey: string, latest: GuardLatest, opts: GuardRunWriteOptions = {}): Promise<void> {
    await this.upsertRun(repoKey, latest, opts);
  }

  async writeGuardRun(
    repoKey: string,
    latest: GuardLatest,
    opts: GuardRunWriteOptions = {},
  ): Promise<WrittenGuardRun> {
    await this.upsertRun(repoKey, latest, opts);
    return { runId: latest.run.runId, latest };
  }

  async readGuardRun(repoKey: string, runId: string): Promise<GuardLatest | null> {
    if (!SAFE_SEGMENT.test(runId)) return null;
    const rows = await this.db
      .select({ snapshot: guardRuns.snapshot })
      .from(guardRuns)
      .where(and(eq(guardRuns.repoKey, repoKey), eq(guardRuns.runId, runId)))
      .limit(1);
    return rows[0] ? (rows[0].snapshot as GuardLatest) : null;
  }

  /** The newest run at an exact commit in a scope. */
  async readGuardRunForCommit(
    repoKey: string,
    commitSha: string,
    scope: string = DEFAULT_VERSION_SCOPE,
  ): Promise<GuardLatest | null> {
    const rows = await this.db
      .select({ snapshot: guardRuns.snapshot })
      .from(guardRuns)
      .where(
        and(
          eq(guardRuns.repoKey, repoKey),
          eq(guardRuns.scope, scope),
          eq(guardRuns.commitSha, commitSha),
        ),
      )
      .orderBy(desc(guardRuns.ranAt), desc(guardRuns.runId))
      .limit(1);
    return rows[0] ? (rows[0].snapshot as GuardLatest) : null;
  }

  /**
   * The run trend: one scope's runs, oldest-first. With `all`, every stored
   * run of every scope — each entry carrying the envelope's provenance
   * (`origin`, `pullRequest`).
   */
  async readGuardHistory(repoKey: string, opts: GuardHistoryReadOptions = {}): Promise<GuardHistory> {
    const rows = await this.db
      .select({ snapshot: guardRuns.snapshot })
      .from(guardRuns)
      .where(
        opts.all
          ? eq(guardRuns.repoKey, repoKey)
          : and(eq(guardRuns.repoKey, repoKey), eq(guardRuns.scope, scopeOf(opts))),
      )
      .orderBy(asc(guardRuns.ranAt), asc(guardRuns.runId));
    const runs: GuardHistoryEntry[] = rows.map((r) => guardHistoryEntryOf(r.snapshot as GuardLatest));
    return { runs };
  }

  // History is derived from the run rows — nothing to append.
  async appendGuardHistory(): Promise<void> {}

  /** Record a run's section and flow summaries on its own row, by run id. */
  async writeGuardRunCoverage(repoKey: string, run: GuardRunCoverage): Promise<void> {
    if (!SAFE_SEGMENT.test(run.runId)) {
      throw new Error(`[data-store] unsafe guard run id: ${run.runId}`);
    }
    await this.db
      .update(guardRuns)
      .set({ sections: run.sections, flows: run.flows })
      .where(and(eq(guardRuns.repoKey, repoKey), eq(guardRuns.runId, run.runId)));
  }

  /** Every run of the scope carrying a section summary, oldest first. */
  async readGuardRunCoverage(
    repoKey: string,
    scope: string = DEFAULT_VERSION_SCOPE,
  ): Promise<GuardRunCoverage[]> {
    const rows = await this.db
      .select({
        runId: guardRuns.runId,
        ranAt: guardRuns.ranAt,
        commitSha: guardRuns.commitSha,
        sections: guardRuns.sections,
        flows: guardRuns.flows,
      })
      .from(guardRuns)
      .where(
        and(
          eq(guardRuns.repoKey, repoKey),
          eq(guardRuns.scope, scope),
          isNotNull(guardRuns.sections),
        ),
      )
      .orderBy(asc(guardRuns.ranAt), asc(guardRuns.runId));
    return rows.map((r) => ({
      runId: r.runId,
      ranAt: r.ranAt,
      commit: r.commitSha,
      sections: r.sections as GuardRunSectionSummary,
      flows: (r.flows as GuardRunFlowSummary | null) ?? null,
    }));
  }

  /** The report `at` names: one by id, the newest at a commit, or the scope's newest. */
  async readGuardResult(repoKey: string, at: VersionAt = {}): Promise<GuardGenerateReport | null> {
    const rows = await this.db
      .select({ report: guardResults.report })
      .from(guardResults)
      .where(this.versionWhere(guardResults, repoKey, at))
      .orderBy(desc(guardResults.createdAt), desc(guardResults.id))
      .limit(1);
    return rows[0] ? (rows[0].report as GuardGenerateReport) : null;
  }

  async writeGuardResult(
    ref: RepoRef,
    report: GuardGenerateReport,
    provenance: VersionProvenance = {},
  ): Promise<void> {
    const commitSha = requireCommit(ref, 'writeGuardResult');
    const scope = scopeOf(ref);
    // The set this report was written beside: a generate saves its set, then
    // its report, so the scope's newest set at the commit is the pair. A
    // blocked generate stored no set, and its report pairs with none.
    const [set] = await this.db
      .select({ id: guardScenarioSets.id })
      .from(guardScenarioSets)
      .where(this.versionWhere(guardScenarioSets, ref.repoKey, { scope, commitSha }))
      .orderBy(desc(guardScenarioSets.createdAt), desc(guardScenarioSets.id))
      .limit(1);
    const now = new Date();
    await this.db.insert(guardResults).values({
      id: newVersionId(now),
      repoKey: ref.repoKey,
      commitSha,
      report,
      scope,
      producedByRun: provenance.producedByRun ?? null,
      model: provenance.model ?? null,
      scenarioSetId: set?.id ?? null,
      generatedAt: report.generatedAt,
      createdAt: now.toISOString(),
    });
    await sweepGuardSeries(this.db, guardResults, ref.repoKey, scope);
  }

  /**
   * The commit the scope's CURRENT state was produced at: the newest of its
   * scenario sets and its reports, whichever was stored last. A generate
   * stores its set and then its report at one commit; a blocked generate
   * stores a report alone at the commit it was blocked at, and that report IS
   * the current state — the views read its status, and resolving the last
   * conflict re-enqueues on it. Null when the scope holds neither.
   */
  async readGuardBaselineCommit(
    repoKey: string,
    scope: string = DEFAULT_VERSION_SCOPE,
  ): Promise<string | null> {
    let newest: { commitSha: string; createdAt: string; id: string } | null = null;
    for (const table of [guardScenarioSets, guardResults] as const) {
      const [row] = await this.db
        .select({ commitSha: table.commitSha, createdAt: table.createdAt, id: table.id })
        .from(table)
        .where(and(eq(table.repoKey, repoKey), eq(table.scope, scope)))
        .orderBy(desc(table.createdAt), desc(table.id))
        .limit(1);
      if (!row) continue;
      const [t, prev] = [new Date(row.createdAt).getTime(), newest ? new Date(newest.createdAt).getTime() : -1];
      if (!newest || t > prev || (t === prev && row.id > newest.id)) newest = row;
    }
    return newest?.commitSha ?? null;
  }

  /**
   * Insert a run under its scope, or update the row its run id already has
   * (the adjudication fold re-writing a run keeps the row's scope, provenance
   * and evidence manifest — `writeGuardEvidence` owns that one).
   */
  private async upsertRun(repoKey: string, latest: GuardLatest, opts: GuardRunWriteOptions): Promise<void> {
    const commitSha = latest.run.commit ?? latest.run.runId;
    await this.db
      .insert(guardRuns)
      .values({
        repoKey,
        commitSha,
        branch: latest.run.branch,
        runId: latest.run.runId,
        snapshot: latest,
        summary: latest.summary,
        evidence: {},
        scope: scopeOf(opts),
        producedByRun: opts.provenance?.producedByRun ?? null,
        model: opts.provenance?.model ?? null,
        ranAt: latest.run.ranAt,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [guardRuns.repoKey, guardRuns.runId],
        set: {
          commitSha,
          branch: latest.run.branch,
          snapshot: latest,
          summary: latest.summary,
          ranAt: latest.run.ranAt,
        },
      });
  }

  // --- Evidence -------------------------------------------------------------

  async writeGuardEvidence(
    repoKey: string,
    runId: string,
    scenarioId: string,
    files: Record<string, string | Buffer>,
  ): Promise<string> {
    if (!SAFE_SEGMENT.test(runId)) {
      throw new Error(`[data-store] unsafe guard run id: ${runId}`);
    }
    const entries = await this.putEvidenceFiles(repoKey, sanitizeSegment(scenarioId), files);

    // Merge the new entries onto the run row's evidence manifest atomically —
    // a single jsonb `||` UPDATE, so two scenarios' concurrent writes to the same
    // run can never drop each other's entries (a read-modify-write would race).
    // The run snapshot is persisted first (its evidencePath pointers are computed
    // deterministically from runId + scenarioId, so it needs no evidence yet);
    // the RETURNING row doubles as the "run row exists" check.
    const updated = await this.db
      .update(guardRuns)
      .set({ evidence: sql`${guardRuns.evidence} || ${JSON.stringify(entries)}::jsonb` })
      .where(and(eq(guardRuns.repoKey, repoKey), eq(guardRuns.runId, runId)))
      .returning({ runId: guardRuns.runId });
    if (updated.length === 0) {
      throw new Error(`[data-store] no guard run ${runId} to attach evidence to`);
    }

    return evidenceRelPath(runId, scenarioId);
  }

  /**
   * Store a scenario's evidence files under the repo's evidence pool and return
   * the manifest entries (`<scenarioSeg>/<file>` → sha). A text body is stored as
   * text; a `Buffer` — a screenshot, the session video — as bytes, and the file's
   * NAME says which it was when it is read back (see `readGuardEvidenceBytesAt`).
   */
  private async putEvidenceFiles(
    repoKey: string,
    scenarioSeg: string,
    files: Record<string, string | Buffer>,
  ): Promise<Record<string, string>> {
    const scope = contentScope.guardEvidence(repoKey);
    const entries: Record<string, string> = {};
    for (const [file, body] of Object.entries(files)) {
      if (!SAFE_SEGMENT.test(file)) {
        throw new Error(`[data-store] unsafe evidence file name: ${file}`);
      }
      const sha = Buffer.isBuffer(body)
        ? await this.content.putBytes(scope, body)
        : await this.content.putText(scope, body);
      entries[`${scenarioSeg}/${file}`] = sha;
    }
    return entries;
  }

  async writeGuardResultEvidence(
    ref: RepoRef,
    scenarioSeg: string,
    files: Record<string, string | Buffer>,
  ): Promise<void> {
    const commitSha = requireCommit(ref, 'writeGuardResultEvidence');
    const entries = await this.putEvidenceFiles(ref.repoKey, sanitizeSegment(scenarioSeg), files);

    // Merge onto the NEWEST report at that commit — the one `writeGuardResult`
    // just wrote — atomically (jsonb `||`), mirroring `writeGuardEvidence` for
    // runs: concurrent birth-finding writes for the same report can never drop
    // each other's entries. The RETURNING row doubles as the "report exists" check.
    const [target] = await this.db
      .select({ id: guardResults.id })
      .from(guardResults)
      .where(this.versionWhere(guardResults, ref.repoKey, { scope: ref.scope, commitSha }))
      .orderBy(desc(guardResults.createdAt), desc(guardResults.id))
      .limit(1);
    const updated = target
      ? await this.db
          .update(guardResults)
          .set({ evidence: sql`${guardResults.evidence} || ${JSON.stringify(entries)}::jsonb` })
          .where(eq(guardResults.id, target.id))
          .returning({ id: guardResults.id })
      : [];
    if (updated.length === 0) {
      throw new Error(
        `[data-store] no guard result for ${ref.repoKey}@${commitSha} to attach evidence to`,
      );
    }
  }

  async readGuardEvidence(
    repoKey: string,
    runId: string,
    scenarioId: string,
    file: string,
  ): Promise<string | null> {
    if (!SAFE_SEGMENT.test(runId) || !SAFE_SEGMENT.test(file)) return null;
    return this.resolveEvidence(repoKey, runId, `${sanitizeSegment(scenarioId)}/${file}`);
  }

  async readGuardEvidenceAt(
    repoKey: string,
    evidenceDir: string,
    file: string,
  ): Promise<string | null> {
    if (!SAFE_SEGMENT.test(file)) return null;
    const located = await this.locateEvidenceSha(repoKey, evidenceDir, file);
    return located ? this.content.get(contentScope.guardEvidence(repoKey), located) : null;
  }

  async listGuardEvidenceAt(repoKey: string, evidenceDir: string): Promise<string[]> {
    const dir = parseEvidenceDir(evidenceDir);
    if (!dir) return [];
    const manifest = await this.evidenceManifestFor(repoKey, dir.runId, dir.scenarioSeg);
    const prefix = `${dir.scenarioSeg}/`;
    return Object.keys(manifest ?? {})
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort();
  }

  async readGuardEvidenceBytesAt(
    repoKey: string,
    evidenceDir: string,
    file: string,
  ): Promise<Buffer | null> {
    if (!SAFE_SEGMENT.test(file)) return null;
    const sha = await this.locateEvidenceSha(repoKey, evidenceDir, file);
    if (!sha) return null;
    const scope = contentScope.guardEvidence(repoKey);
    // A visual artifact was stored as bytes; everything else is text, read as UTF-8.
    if (guardEvidenceVisual(file)) return this.content.getBytes(scope, sha);
    const text = await this.content.get(scope, sha);
    return text == null ? null : Buffer.from(text, 'utf-8');
  }

  /** The sha behind `<evidenceDir>/<file>`, or null — see `evidenceManifestFor`. */
  private async locateEvidenceSha(
    repoKey: string,
    evidenceDir: string,
    file: string,
  ): Promise<string | null> {
    const dir = parseEvidenceDir(evidenceDir);
    if (!dir) return null;
    const manifest = await this.evidenceManifestFor(repoKey, dir.runId, dir.scenarioSeg);
    return manifest?.[`${dir.scenarioSeg}/${file}`] ?? null;
  }

  /**
   * The evidence manifest an evidence dir resolves in. A run's own first: when a
   * run row matches the runId it is authoritative — a missing key there is a
   * miss, not a cue to fall through to some other report's transcript. No run
   * row means a BIRTH finding's bundle: its evidencePath embeds a generate runId
   * that never created a `guard_runs` row, so it hangs off a `guard_results`
   * manifest instead (see `writeGuardResultEvidence`), the newest report
   * holding that scenario's keys winning.
   */
  private async evidenceManifestFor(
    repoKey: string,
    runId: string,
    scenarioSeg: string,
  ): Promise<Record<string, string> | null> {
    const manifest = await this.runEvidenceManifest(repoKey, runId);
    if (manifest) return manifest;
    return this.resultEvidenceManifest(repoKey, `${scenarioSeg}/`);
  }

  /** A run row's evidence manifest, or `null` when no row matches the runId. */
  private async runEvidenceManifest(
    repoKey: string,
    runId: string,
  ): Promise<Record<string, string> | null> {
    const [row] = await this.db
      .select({ evidence: guardRuns.evidence })
      .from(guardRuns)
      .where(and(eq(guardRuns.repoKey, repoKey), eq(guardRuns.runId, runId)))
      .limit(1);
    return row ? ((row.evidence as Record<string, string> | null) ?? {}) : null;
  }

  /** Resolve `<scenarioSeg>/<file>` in a run's evidence manifest → the content body. */
  private async resolveEvidence(
    repoKey: string,
    runId: string,
    manifestKey: string,
  ): Promise<string | null> {
    const manifest = await this.runEvidenceManifest(repoKey, runId);
    const sha = manifest?.[manifestKey];
    if (!sha) return null;
    return this.content.get(contentScope.guardEvidence(repoKey), sha);
  }

  /**
   * The newest `guard_results` evidence manifest holding a key under `prefix`
   * (`<scenarioSeg>/`). Unlike runs, results aren't keyed by runId, so the newest
   * report row wins — a birth finding's runId distinguishes it only from a run
   * row, not between reports; content is content-addressed, so a hit is served
   * from the evidence pool either way. A repo holds few reports, so the scan is
   * over their manifests, newest first.
   */
  private async resultEvidenceManifest(
    repoKey: string,
    prefix: string,
  ): Promise<Record<string, string> | null> {
    const rows = await this.db
      .select({ evidence: guardResults.evidence })
      .from(guardResults)
      .where(eq(guardResults.repoKey, repoKey))
      .orderBy(desc(guardResults.createdAt), desc(guardResults.id));
    for (const row of rows) {
      const manifest = (row.evidence as Record<string, string> | null) ?? {};
      if (Object.keys(manifest).some((key) => key.startsWith(prefix))) return manifest;
    }
    return null;
  }

  // --- Versions: the shared row logic --------------------------------------

  /**
   * The rows of a series `at` names: one version by id (any scope, any
   * commit), else the scope's rows, at a commit when one is named. Ordered by
   * the caller, newest first, so `limit(1)` is the current one.
   */
  private versionWhere(
    table: typeof guardResults | ManifestTable,
    repoKey: string,
    at: VersionAt,
  ): SQL {
    if (at.id) return and(eq(table.repoKey, repoKey), eq(table.id, at.id))!;
    const inScope = and(eq(table.repoKey, repoKey), eq(table.scope, scopeOf(at)))!;
    return at.commitSha ? and(inScope, eq(table.commitSha, at.commitSha))! : inScope;
  }

  /** The manifest of the version `at` names in a manifest series, or null. */
  private async manifestFor(table: ManifestTable, repoKey: string, at: VersionAt): Promise<Manifest | null> {
    const rows = await this.db
      .select({ manifest: table.manifest })
      .from(table)
      .where(this.versionWhere(table, repoKey, at))
      .orderBy(desc(table.createdAt), desc(table.id))
      .limit(1);
    return rows[0] ? (rows[0].manifest as Manifest) : null;
  }

  /** Insert a new version of a manifest series and apply retention to that series. */
  private async insertManifestVersion(
    table: ManifestTable,
    ref: RepoRef,
    commitSha: string,
    packed: { manifest: Manifest; manifestHash: string; fileCount: number },
    provenance: VersionProvenance,
  ): Promise<string> {
    const now = new Date();
    const id = newVersionId(now);
    const scope = scopeOf(ref);
    await this.db.insert(table).values({
      id,
      repoKey: ref.repoKey,
      commitSha,
      manifest: packed.manifest,
      manifestHash: packed.manifestHash,
      fileCount: packed.fileCount,
      scope,
      producedByRun: provenance.producedByRun ?? null,
      model: provenance.model ?? null,
      createdAt: now.toISOString(),
    });
    await sweepGuardSeries(this.db, table, ref.repoKey, scope);
    return id;
  }

  // --- Scenario sets --------------------------------------------------------

  async saveScenarios(
    ref: RepoRef,
    sourceDir: string,
    provenance: VersionProvenance = {},
  ): Promise<SaveScenariosResult> {
    const commitSha = requireCommit(ref, 'saveScenarios');
    const files: Record<string, Buffer> = {};
    await mapLimit(walkScenarioRelFiles(sourceDir), OBJECT_CONCURRENCY, async (rel) => {
      assertSafeRel(rel);
      files[rel] = await fsp.readFile(path.join(sourceDir, rel));
    });
    const packed = await packFiles(this.content, contentScope.guard(ref.repoKey), files);
    const versionId = await this.insertManifestVersion(guardScenarioSets, ref, commitSha, packed, provenance);
    return { fileCount: packed.fileCount, versionId };
  }

  /** The newest set at `ref`'s commit in its scope; an empty commit names the scope's newest set. */
  async loadScenarios(ref: RepoRef): Promise<LoadedScenarios> {
    const manifest = await this.manifestFor(guardScenarioSets, ref.repoKey, {
      scope: ref.scope,
      ...(ref.commitSha ? { commitSha: ref.commitSha } : {}),
    });
    if (!manifest) return { scenarios: [], errors: [] };

    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tc-guard-scenarios-'));
    try {
      const scope = contentScope.guard(ref.repoKey);
      const scenariosRoot = scenariosDir(root);
      await mapLimit(Object.entries(manifest.files ?? {}), OBJECT_CONCURRENCY, async ([rel, sha]) => {
        const dest = safeJoin(scenariosRoot, rel);
        const body = await this.content.get(scope, sha);
        if (body == null) {
          throw new Error(
            `[data-store] missing guard object ${sha} for ${rel} (${ref.repoKey}@${ref.commitSha || 'current'})`,
          );
        }
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, body);
      });
      return fileLoadScenarios(root);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }

  async readManifest(repoKey: string, at: VersionAt = {}): Promise<GuardManifest | null> {
    const body = await this.scenarioFileBody(repoKey, 'manifest.json', at);
    if (body == null) return null;
    try {
      const parsed = GuardManifestSchema.safeParse(JSON.parse(body));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async readRecipeRaw(repoKey: string, at: VersionAt = {}): Promise<string | null> {
    return this.scenarioFileBody(repoKey, 'recipe.json', at);
  }

  async listScenarioFiles(repoKey: string, at: VersionAt = {}): Promise<string[]> {
    const manifest = await this.manifestFor(guardScenarioSets, repoKey, at);
    if (!manifest) return [];
    return Object.keys(manifest.files ?? {})
      .filter((rel) => /\.ya?ml$/i.test(rel))
      .map((rel) => `${SCENARIOS_PREFIX}${rel}`)
      .sort();
  }

  async readScenarioFile(repoKey: string, relPath: string, at: VersionAt = {}): Promise<string | null> {
    if (!relPath.startsWith(SCENARIOS_PREFIX)) return null;
    return this.scenarioFileBody(repoKey, relPath.slice(SCENARIOS_PREFIX.length), at);
  }

  /** Body of one scenario-set file by its scenarios-dir-relative path, or null. */
  private async scenarioFileBody(repoKey: string, rel: string, at: VersionAt): Promise<string | null> {
    const manifest = await this.manifestFor(guardScenarioSets, repoKey, at);
    const sha = manifest?.files?.[rel];
    if (!sha) return null;
    return this.content.get(contentScope.guard(repoKey), sha);
  }

  // --- Setup bundle ---------------------------------------------------------

  async saveGuardSetupBundle(
    ref: RepoRef,
    files: Record<string, string>,
    provenance: VersionProvenance = {},
  ): Promise<void> {
    const commitSha = requireCommit(ref, 'saveGuardSetupBundle');
    const bytes: Record<string, Buffer> = {};
    for (const [rel, body] of Object.entries(files)) bytes[rel] = Buffer.from(body, 'utf-8');
    const packed = await packFiles(this.content, contentScope.guard(ref.repoKey), bytes);
    await this.insertManifestVersion(guardSetupSets, ref, commitSha, packed, provenance);
  }

  async loadGuardSetupBundle(repoKey: string, at: VersionAt = {}): Promise<Record<string, string> | null> {
    const manifest = await this.manifestFor(guardSetupSets, repoKey, at);
    if (!manifest) return null;

    const scope = contentScope.guard(repoKey);
    const files: Record<string, string> = {};
    await mapLimit(Object.entries(manifest.files ?? {}), OBJECT_CONCURRENCY, async ([rel, sha]) => {
      // The manifest is stored data; a caller materializes these paths into a
      // working tree, so they are re-checked on the way out too.
      assertSafeRel(rel);
      const body = await this.content.get(scope, sha);
      if (body == null) {
        throw new Error(
          `[data-store] missing guard setup object ${sha} for ${rel} (${repoKey}@${at.commitSha ?? at.id ?? 'current'})`,
        );
      }
      files[rel] = body;
    });
    return files;
  }

  // --- Versions -------------------------------------------------------------

  /** One series' rows as `GuardVersion`s, newest first, under `where`. */
  private async selectVersions(
    artifact: GuardVersionArtifact,
    where: (table: VersionTable) => SQL,
    limit: number,
  ): Promise<GuardVersion[]> {
    const table = versionTable(artifact);
    const rows = await this.db
      .select(versionColumns(table))
      .from(table)
      .where(where(table))
      .orderBy(desc(table.createdAt), desc(table.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, artifact, createdAt: iso(row.createdAt) }));
  }

  async listGuardVersions(
    repoKey: string,
    artifact: GuardVersionArtifact,
    opts: GuardVersionListOptions = {},
  ): Promise<GuardVersion[]> {
    return this.selectVersions(
      artifact,
      (t) => and(eq(t.repoKey, repoKey), eq(t.scope, scopeOf(opts)))!,
      opts.limit ?? 50,
    );
  }

  async readGuardVersion(
    repoKey: string,
    artifact: GuardVersionArtifact,
    versionId: string,
  ): Promise<GuardVersion | null> {
    if (!SAFE_SEGMENT.test(versionId)) return null;
    const [row] = await this.selectVersions(
      artifact,
      (t) => and(eq(t.repoKey, repoKey), eq(t.id, versionId))!,
      1,
    );
    return row ?? null;
  }

  async restoreGuardScenarioSet(
    repoKey: string,
    versionId: string,
    provenance: VersionProvenance = {},
  ): Promise<GuardVersion | null> {
    if (!SAFE_SEGMENT.test(versionId)) return null;
    const [source] = await this.db
      .select()
      .from(guardScenarioSets)
      .where(and(eq(guardScenarioSets.repoKey, repoKey), eq(guardScenarioSets.id, versionId)))
      .limit(1);
    if (!source) return null;
    const now = new Date();
    const id = newVersionId(now);
    await this.db.insert(guardScenarioSets).values({
      id,
      repoKey,
      commitSha: source.commitSha,
      manifest: source.manifest,
      manifestHash: source.manifestHash,
      fileCount: source.fileCount,
      scope: source.scope,
      producedByRun: provenance.producedByRun ?? null,
      model: provenance.model ?? null,
      restoredFrom: source.id,
      createdAt: now.toISOString(),
    });
    await sweepGuardSeries(this.db, guardScenarioSets, repoKey, source.scope);

    // The report the set was born with comes back as current beside it — the
    // newest report paired with the source set, copied with its evidence
    // manifest so its birth-finding transcripts stay reachable and referenced.
    const [report] = await this.db
      .select()
      .from(guardResults)
      .where(and(eq(guardResults.repoKey, repoKey), eq(guardResults.scenarioSetId, source.id)))
      .orderBy(desc(guardResults.createdAt), desc(guardResults.id))
      .limit(1);
    if (report) {
      const reportNow = new Date();
      await this.db.insert(guardResults).values({
        id: newVersionId(reportNow),
        repoKey,
        commitSha: report.commitSha,
        report: report.report,
        evidence: report.evidence,
        scope: report.scope,
        producedByRun: provenance.producedByRun ?? null,
        model: provenance.model ?? null,
        scenarioSetId: id,
        restoredFrom: report.id,
        generatedAt: report.generatedAt,
        createdAt: reportNow.toISOString(),
      });
      await sweepGuardSeries(this.db, guardResults, repoKey, report.scope);
    }
    return {
      id,
      artifact: 'scenarios',
      scope: source.scope,
      commitSha: source.commitSha,
      producedByRun: provenance.producedByRun ?? null,
      model: provenance.model ?? null,
      fileCount: source.fileCount,
      restoredFrom: source.id,
      createdAt: now.toISOString(),
    };
  }

  // --- Decisions ------------------------------------------------------------

  async readGuardDecisions(repoKey: string): Promise<GuardDecisions> {
    const rows = await this.db
      .select({ payload: decisions.payload })
      .from(decisions)
      .where(eq(decisions.scope, decisionsScope(repoKey)))
      .limit(1);
    return rows[0] ? (rows[0].payload as GuardDecisions) : EMPTY_GUARD_DECISIONS;
  }

  async writeGuardDecisions(repoKey: string, guardDecisions: GuardDecisions): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(decisions)
      .values({ scope: decisionsScope(repoKey), payload: guardDecisions, updatedAt: now })
      .onConflictDoUpdate({ target: [decisions.scope], set: { payload: guardDecisions, updatedAt: now } });
  }
}

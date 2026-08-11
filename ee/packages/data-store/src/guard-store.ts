/**
 * Postgres implementation of core's `GuardStore`. Three homes:
 *
 *   - RUN STATE (`guard_runs`, one row per repo+commit):
 *     `writeGuardLatest` marks the default-branch baseline, `writeGuardRun` writes
 *     a (PR-head) snapshot without marking it, `readGuardLatest` is the newest
 *     baseline row, and the run history is every baseline row. `readGuardRun(runId)`
 *     stays LIVE (the `(repo, run_id)` index). The commit key comes from the payload
 *     (`latest.run.commit`), falling
 *     back to the always-present `runId` so distinct runs never collide on the PK.
 *     Re-running guard on the SAME commit upserts that row — latest wins: the
 *     previous run's history point is replaced, its runId stops resolving via
 *     `readGuardRun` (the row's `run_id` is overwritten), and its evidence
 *     manifest resets to `{}` so the old transcripts are never served under the
 *     new runId (the blobs remain in `content`, unreferenced). Deliberate: one row
 *     per commit, unlike the OSS append-only `history.json`.
 *
 *   - EVIDENCE — per-run transcripts, content-addressed in `content` (scope
 *     `guard-evidence:<repo>`); the run row's `evidence` jsonb is the
 *     `{ "<scenarioId>/<file>": sha }` manifest that points in. BIRTH findings run
 *     with `persist: false` (no run row), so their transcripts hang off the generate
 *     report (`guard_results.evidence`, same shape) instead — `readGuardEvidenceAt`
 *     falls back to it when the evidence path's runId matches no run row.
 *
 *   - SCENARIO CORPUS (`guard_scenario_sets`) — content-addressed and keyed
 *     per (repo, commit): the committable `scenarios/` tree (yaml +
 *     recipe.json + manifest.json) is deduped into `content` (scope `guard:<repo>`)
 *     with a per-(repo, commit) `{ relPath: sha }` manifest row. `saveScenarios`
 *     takes a `RepoRef` and rejects an empty commit; `loadScenarios(ref)` is that
 *     commit's set (exact — no fallback, like `loadContracts`), materialized into
 *     a temp dir the unchanged guard-runner loader reads; the browse reads take an
 *     optional commit and fall back to the newest stored set. The generate report
 *     (`guard_results`) is keyed the same way.
 *
 *   - DECISIONS — the mutable `dismissedClaims` ledger reuses the generic
 *     `decisions` table under a `guard:<repo>` scope (`#pr/<n>` for a PR overlay),
 *     mirroring how `PgSpecStore` routes its decisions scopes. An absent row reads
 *     as `EMPTY_GUARD_DECISIONS` (never null) — core's overlay promotion keys the
 *     "no overlay" signal on `dismissedClaims.length === 0`.
 *
 * In EE the `repoPath` argument carries the stable repo key (as in the other EE
 * stores), not an on-disk path — `materializesInPlace` is false.
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  guardRuns,
  guardResults,
  guardScenarioSets,
  decisions,
  type EeDb,
} from '@truecourse/ee-db';
import type {
  GuardStore,
  RepoRef,
  SaveScenariosResult,
  WrittenGuardRun,
} from '@truecourse/core/lib/guard-store';
import {
  GuardManifestSchema,
  EMPTY_GUARD_DECISIONS,
  type GuardDecisions,
  type GuardGenerateReport,
  type GuardHistory,
  type GuardHistoryEntry,
  type GuardLatest,
  type GuardManifest,
} from '@truecourse/shared';
import {
  loadScenarios as fileLoadScenarios,
  evidenceRelPath,
  sanitizeSegment,
  walkScenarioRelFiles,
  type LoadedScenarios,
} from '@truecourse/guard-runner';
import { ContentStore, contentScope } from './content-store.js';
import { assertSafeRel, mapLimit, safeJoin, sha256, sortKeys } from './pack.js';

const OBJECT_CONCURRENCY = 16;

/** Reject an empty commit on the per-commit writes (mirrors `assertCommit`). */
function requireCommit(ref: RepoRef, what: string): string {
  if (!ref.commitSha) {
    throw new Error(`[ee-data-store] ${what} requires a non-empty commit SHA`);
  }
  return ref.commitSha;
}

/** Run ids / evidence filenames — plain segments, no separators, no `..`. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** The repo-relative prefix guard scenario paths are listed / read under. */
const SCENARIOS_PREFIX = '.truecourse/scenarios/';

interface Manifest {
  v: number;
  files: Record<string, string>;
}

/** Evidence pointer prefix (`evidenceRelPath` shape): `.truecourse/guard/evidence/`. */
const EVIDENCE_PREFIX_SEGMENTS = ['.truecourse', 'guard', 'evidence'];

/**
 * Read a repo-relative evidence DIRECTORY as the pair it addresses, or `null` when
 * it is not one: the shape is exactly `<prefix>/<runId>/<scenarioSeg>`, and both
 * segments must be plain — the hosted analogue of the file store's path
 * confinement, since there is no path here to resolve.
 */
function parseEvidenceDir(evidenceDir: string): { runId: string; scenarioSeg: string } | null {
  const segs = evidenceDir.split('/');
  if (segs.length !== EVIDENCE_PREFIX_SEGMENTS.length + 2) return null;
  if (segs.slice(0, EVIDENCE_PREFIX_SEGMENTS.length).join('/') !== EVIDENCE_PREFIX_SEGMENTS.join('/')) {
    return null;
  }
  const [runId, scenarioSeg] = segs.slice(EVIDENCE_PREFIX_SEGMENTS.length);
  if (!SAFE_SEGMENT.test(runId!) || !SAFE_SEGMENT.test(scenarioSeg!)) return null;
  return { runId: runId!, scenarioSeg: scenarioSeg! };
}

export class PgGuardStore implements GuardStore {
  readonly materializesInPlace = false;
  private readonly content: ContentStore;

  constructor(private readonly db: EeDb) {
    this.content = new ContentStore(db);
  }

  // --- Run state ------------------------------------------------------------

  async readGuardLatest(repoKey: string): Promise<GuardLatest | null> {
    const rows = await this.db
      .select({ snapshot: guardRuns.snapshot })
      .from(guardRuns)
      .where(and(eq(guardRuns.repoKey, repoKey), eq(guardRuns.isBaseline, true)))
      .orderBy(desc(guardRuns.ranAt))
      .limit(1);
    return rows[0] ? (rows[0].snapshot as GuardLatest) : null;
  }

  async writeGuardLatest(repoKey: string, latest: GuardLatest): Promise<void> {
    await this.upsertRun(repoKey, latest, true);
  }

  async writeGuardRun(repoKey: string, latest: GuardLatest): Promise<WrittenGuardRun> {
    await this.upsertRun(repoKey, latest, false);
    return { runId: latest.run.runId, latest };
  }

  async readGuardRun(repoKey: string, runId: string): Promise<GuardLatest | null> {
    if (!SAFE_SEGMENT.test(runId)) return null;
    const rows = await this.db
      .select({ snapshot: guardRuns.snapshot })
      .from(guardRuns)
      .where(and(eq(guardRuns.repoKey, repoKey), eq(guardRuns.runId, runId)))
      .orderBy(desc(guardRuns.ranAt))
      .limit(1);
    return rows[0] ? (rows[0].snapshot as GuardLatest) : null;
  }

  /** The `(repoKey, commitSha)` row's snapshot (PK lookup) — baseline or PR-head. */
  async readGuardRunForCommit(repoKey: string, commitSha: string): Promise<GuardLatest | null> {
    const rows = await this.db
      .select({ snapshot: guardRuns.snapshot })
      .from(guardRuns)
      .where(and(eq(guardRuns.repoKey, repoKey), eq(guardRuns.commitSha, commitSha)))
      .limit(1);
    return rows[0] ? (rows[0].snapshot as GuardLatest) : null;
  }

  /** The run trend: every baseline run for the repo, oldest-first. */
  async readGuardHistory(repoKey: string): Promise<GuardHistory> {
    const rows = await this.db
      .select({ snapshot: guardRuns.snapshot })
      .from(guardRuns)
      .where(and(eq(guardRuns.repoKey, repoKey), eq(guardRuns.isBaseline, true)))
      .orderBy(asc(guardRuns.ranAt));
    const runs: GuardHistoryEntry[] = rows.map((r) => {
      const latest = r.snapshot as GuardLatest;
      return {
        runId: latest.run.runId,
        ranAt: latest.run.ranAt,
        branch: latest.run.branch,
        commit: latest.run.commit,
        summary: latest.summary,
      };
    });
    return { runs };
  }

  // History is derived from the baseline rows — nothing to append.
  async appendGuardHistory(): Promise<void> {}

  /** A specific commit's generate report, or the newest stored one when omitted. */
  async readGuardResult(repoKey: string, commitSha?: string): Promise<GuardGenerateReport | null> {
    const where = commitSha
      ? and(eq(guardResults.repoKey, repoKey), eq(guardResults.commitSha, commitSha))
      : eq(guardResults.repoKey, repoKey);
    const rows = await this.db
      .select({ report: guardResults.report })
      .from(guardResults)
      .where(where)
      .orderBy(desc(guardResults.createdAt))
      .limit(1);
    return rows[0] ? (rows[0].report as GuardGenerateReport) : null;
  }

  async writeGuardResult(ref: RepoRef, report: GuardGenerateReport): Promise<void> {
    const commitSha = requireCommit(ref, 'writeGuardResult');
    const now = new Date().toISOString();
    await this.db
      .insert(guardResults)
      .values({
        repoKey: ref.repoKey,
        commitSha,
        report,
        generatedAt: report.generatedAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [guardResults.repoKey, guardResults.commitSha],
        set: { report, generatedAt: report.generatedAt, updatedAt: now },
      });
  }

  /**
   * Upsert a run snapshot keyed by repo+commit; a baseline write marks the row.
   * A same-commit rerun REPLACES the row's snapshot/summary/run_id (latest wins —
   * see the file header): the old runId no longer resolves, its history data
   * point is gone, and the evidence manifest resets. One-row-per-commit semantics.
   */
  private async upsertRun(repoKey: string, latest: GuardLatest, markBaseline: boolean): Promise<void> {
    const commitSha = latest.run.commit ?? latest.run.runId;
    const now = new Date().toISOString();
    // `evidence` resets to `{}` ONLY when the incoming runId differs (a same-commit
    // RERUN) — the previous run's transcripts must never be served under the new
    // runId; the blobs stay in `content` (content-addressed), just unreferenced.
    // A same-runId re-upsert (`writeGuardLatest` marking baseline after
    // `writeGuardRun` already wrote the row, or an idempotent re-write) keeps the
    // manifest: `writeGuardEvidence` owns it and must not be clobbered.
    const set: Record<string, unknown> = {
      branch: latest.run.branch,
      runId: latest.run.runId,
      snapshot: latest,
      summary: latest.summary,
      ranAt: latest.run.ranAt,
      evidence: sql`CASE WHEN ${guardRuns.runId} <> excluded.run_id THEN '{}'::jsonb ELSE ${guardRuns.evidence} END`,
    };
    if (markBaseline) set.isBaseline = true;
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
        isBaseline: markBaseline,
        ranAt: latest.run.ranAt,
        createdAt: now,
      })
      .onConflictDoUpdate({ target: [guardRuns.repoKey, guardRuns.commitSha], set });
  }

  // --- Evidence -------------------------------------------------------------

  async writeGuardEvidence(
    repoKey: string,
    runId: string,
    scenarioId: string,
    files: Record<string, string>,
  ): Promise<string> {
    if (!SAFE_SEGMENT.test(runId)) {
      throw new Error(`[ee-data-store] unsafe guard run id: ${runId}`);
    }
    const scope = contentScope.guardEvidence(repoKey);
    const scenarioSeg = sanitizeSegment(scenarioId);
    const entries: Record<string, string> = {};
    for (const [file, body] of Object.entries(files)) {
      if (!SAFE_SEGMENT.test(file)) {
        throw new Error(`[ee-data-store] unsafe evidence file name: ${file}`);
      }
      const sha = await this.content.putText(scope, body);
      entries[`${scenarioSeg}/${file}`] = sha;
    }

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
      throw new Error(`[ee-data-store] no guard run ${runId} to attach evidence to`);
    }

    return evidenceRelPath(runId, scenarioId);
  }

  async writeGuardResultEvidence(
    ref: RepoRef,
    scenarioSeg: string,
    files: Record<string, string>,
  ): Promise<void> {
    const commitSha = requireCommit(ref, 'writeGuardResultEvidence');
    const scope = contentScope.guardEvidence(ref.repoKey);
    const seg = sanitizeSegment(scenarioSeg);
    const entries: Record<string, string> = {};
    for (const [file, body] of Object.entries(files)) {
      if (!SAFE_SEGMENT.test(file)) {
        throw new Error(`[ee-data-store] unsafe evidence file name: ${file}`);
      }
      const sha = await this.content.putText(scope, body);
      entries[`${seg}/${file}`] = sha;
    }

    // Merge onto the generate report's evidence manifest atomically (jsonb `||`),
    // mirroring `writeGuardEvidence` for runs — concurrent birth-finding writes for
    // the same report can never drop each other's entries. The report row is written
    // first (`writeGuardResult`); the RETURNING row doubles as the "report exists" check.
    const updated = await this.db
      .update(guardResults)
      .set({ evidence: sql`${guardResults.evidence} || ${JSON.stringify(entries)}::jsonb` })
      .where(and(eq(guardResults.repoKey, ref.repoKey), eq(guardResults.commitSha, commitSha)))
      .returning({ repoKey: guardResults.repoKey });
    if (updated.length === 0) {
      throw new Error(
        `[ee-data-store] no guard result for ${ref.repoKey}@${commitSha} to attach evidence to`,
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
    const at = parseEvidenceDir(evidenceDir);
    if (!at) return null;
    const key = `${at.scenarioSeg}/${file}`;
    // A run's evidence first (a `fail`/`error` transcript from a persisted run).
    // When a run row matches the runId it is authoritative — a missing key there is
    // a miss, not a cue to fall through to some other report's transcript.
    const manifest = await this.runEvidenceManifest(repoKey, at.runId);
    if (manifest) {
      const sha = manifest[key];
      return sha ? this.content.get(contentScope.guardEvidence(repoKey), sha) : null;
    }
    // No run row: a BIRTH finding's transcript. Its evidencePath embeds a generate
    // runId that never created a `guard_runs` row, so the transcript hangs off a
    // `guard_results` evidence manifest instead (see `writeGuardResultEvidence`).
    return this.resolveResultEvidence(repoKey, key);
  }

  /**
   * The bundle's file names, out of the same manifest the reads resolve against:
   * every key under `<scenarioSeg>/`, with the prefix stripped. A run row is
   * authoritative when one matches; otherwise the newest generate report holding
   * that scenario's keys answers, mirroring `readGuardEvidenceAt`'s fallback.
   */
  async listGuardEvidenceAt(repoKey: string, evidenceDir: string): Promise<string[]> {
    const at = parseEvidenceDir(evidenceDir);
    if (!at) return [];
    const prefix = `${at.scenarioSeg}/`;
    const manifest =
      (await this.runEvidenceManifest(repoKey, at.runId)) ??
      (await this.resultEvidenceManifest(repoKey, prefix));
    if (!manifest) return [];
    return Object.keys(manifest)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
      .sort();
  }

  /**
   * The bytes of one evidence file. The hosted evidence channel is TEXT — the
   * writers hand it `Record<string, string>` and the content pool stores it as
   * text — so the bytes of a stored artifact are its UTF-8 encoding. A binary
   * artifact (a screenshot, a session video) never enters this store, and so is
   * never listed here either.
   */
  async readGuardEvidenceBytesAt(
    repoKey: string,
    evidenceDir: string,
    file: string,
  ): Promise<Buffer | null> {
    const text = await this.readGuardEvidenceAt(repoKey, evidenceDir, file);
    return text == null ? null : Buffer.from(text, 'utf-8');
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
   * The newest `guard_results` evidence manifest holding ANY key under `prefix`
   * (`<scenarioSeg>/`) — the listing's half of `resolveResultEvidence`'s fallback,
   * for a birth finding whose runId created no run row.
   */
  private async resultEvidenceManifest(
    repoKey: string,
    prefix: string,
  ): Promise<Record<string, string> | null> {
    const [row] = await this.db
      .select({ evidence: guardResults.evidence })
      .from(guardResults)
      .where(
        and(
          eq(guardResults.repoKey, repoKey),
          sql`EXISTS (SELECT 1 FROM jsonb_object_keys(${guardResults.evidence}) k WHERE k LIKE ${`${prefix}%`})`,
        ),
      )
      .orderBy(desc(guardResults.createdAt))
      .limit(1);
    return row ? ((row.evidence as Record<string, string> | null) ?? {}) : null;
  }

  /**
   * Resolve `<scenarioSeg>/<file>` against a `guard_results` evidence manifest → the
   * content body. Unlike runs, results aren't keyed by runId, so the newest report
   * row holding the key wins (filtered in SQL) — a birth finding's runId
   * distinguishes it only from a run row, not between reports; content is
   * content-addressed, so a hit is served from the evidence pool.
   */
  private async resolveResultEvidence(repoKey: string, manifestKey: string): Promise<string | null> {
    const [row] = await this.db
      .select({ evidence: guardResults.evidence })
      .from(guardResults)
      .where(
        and(
          eq(guardResults.repoKey, repoKey),
          sql`jsonb_exists(${guardResults.evidence}, ${manifestKey})`,
        ),
      )
      .orderBy(desc(guardResults.createdAt))
      .limit(1);
    const sha = (row?.evidence as Record<string, string> | undefined)?.[manifestKey];
    if (!sha) return null;
    return this.content.get(contentScope.guardEvidence(repoKey), sha);
  }

  // --- Scenario corpus ------------------------------------------------------

  async saveScenarios(ref: RepoRef, sourceDir: string): Promise<SaveScenariosResult> {
    const commitSha = requireCommit(ref, 'saveScenarios');
    const files = walkScenarioRelFiles(sourceDir);
    const manifest: Record<string, string> = {};
    const uniqueBytes = new Map<string, Buffer>();
    await mapLimit(files, OBJECT_CONCURRENCY, async (rel) => {
      assertSafeRel(rel);
      const bytes = await fsp.readFile(path.join(sourceDir, rel));
      const sha = sha256(bytes);
      manifest[rel] = sha;
      if (!uniqueBytes.has(sha)) uniqueBytes.set(sha, bytes);
    });

    const scope = contentScope.guard(ref.repoKey);
    await mapLimit([...uniqueBytes.keys()], OBJECT_CONCURRENCY, async (sha) => {
      await this.content.put(scope, sha, uniqueBytes.get(sha)!.toString('utf-8'));
    });

    const sortedFiles = sortKeys(manifest);
    const manifestHash = sha256(Buffer.from(JSON.stringify(sortedFiles)));
    const payload: Manifest = { v: 1, files: sortedFiles };
    const now = new Date().toISOString();
    await this.db
      .insert(guardScenarioSets)
      .values({
        repoKey: ref.repoKey,
        commitSha,
        manifest: payload,
        manifestHash,
        fileCount: files.length,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [guardScenarioSets.repoKey, guardScenarioSets.commitSha],
        set: { manifest: payload, manifestHash, fileCount: files.length, updatedAt: now },
      });

    return { fileCount: files.length };
  }

  /** Exactly that commit's set (no latest fallback — mirrors `loadContracts`). */
  async loadScenarios(ref: RepoRef): Promise<LoadedScenarios> {
    const manifest = await this.commitManifest(ref);
    if (!manifest) return { scenarios: [], errors: [] };

    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tc-guard-scenarios-'));
    try {
      const scope = contentScope.guard(ref.repoKey);
      const scenariosRoot = path.join(root, '.truecourse', 'scenarios');
      await mapLimit(Object.entries(manifest.files ?? {}), OBJECT_CONCURRENCY, async ([rel, sha]) => {
        const dest = safeJoin(scenariosRoot, rel);
        const body = await this.content.get(scope, sha);
        if (body == null) {
          throw new Error(
            `[ee-data-store] missing guard object ${sha} for ${rel} (${ref.repoKey}@${ref.commitSha})`,
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

  async readManifest(repoKey: string, commitSha?: string): Promise<GuardManifest | null> {
    const body = await this.scenarioFileBody(repoKey, 'manifest.json', commitSha);
    if (body == null) return null;
    try {
      const parsed = GuardManifestSchema.safeParse(JSON.parse(body));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async readRecipeRaw(repoKey: string, commitSha?: string): Promise<string | null> {
    return this.scenarioFileBody(repoKey, 'recipe.json', commitSha);
  }

  async listScenarioFiles(repoKey: string, commitSha?: string): Promise<string[]> {
    const manifest = await this.manifestFor(repoKey, commitSha);
    if (!manifest) return [];
    return Object.keys(manifest.files ?? {})
      .filter((rel) => /\.ya?ml$/i.test(rel))
      .map((rel) => `${SCENARIOS_PREFIX}${rel}`)
      .sort();
  }

  async readScenarioFile(repoKey: string, relPath: string, commitSha?: string): Promise<string | null> {
    if (!relPath.startsWith(SCENARIOS_PREFIX)) return null;
    return this.scenarioFileBody(repoKey, relPath.slice(SCENARIOS_PREFIX.length), commitSha);
  }

  /** Body of one scenario-set file by its scenarios-dir-relative path, or null. */
  private async scenarioFileBody(
    repoKey: string,
    rel: string,
    commitSha?: string,
  ): Promise<string | null> {
    const manifest = await this.manifestFor(repoKey, commitSha);
    const sha = manifest?.files?.[rel];
    if (!sha) return null;
    return this.content.get(contentScope.guard(repoKey), sha);
  }

  /** Manifest of a specific commit's set, or the latest (mirrors `manifestFor`). */
  private async manifestFor(repoKey: string, commitSha?: string): Promise<Manifest | null> {
    if (!commitSha) return this.latestManifest(repoKey);
    return this.commitManifest({ repoKey, commitSha });
  }

  /** Manifest of the most-recently-stored set — the "current" set to browse. */
  private async latestManifest(repoKey: string): Promise<Manifest | null> {
    const rows = await this.db
      .select({ manifest: guardScenarioSets.manifest })
      .from(guardScenarioSets)
      .where(eq(guardScenarioSets.repoKey, repoKey))
      .orderBy(desc(guardScenarioSets.createdAt))
      .limit(1);
    return rows[0] ? (rows[0].manifest as Manifest) : null;
  }

  private async commitManifest(ref: RepoRef): Promise<Manifest | null> {
    const rows = await this.db
      .select({ manifest: guardScenarioSets.manifest })
      .from(guardScenarioSets)
      .where(
        and(eq(guardScenarioSets.repoKey, ref.repoKey), eq(guardScenarioSets.commitSha, ref.commitSha)),
      )
      .limit(1);
    return rows[0] ? (rows[0].manifest as Manifest) : null;
  }

  // --- Decisions ------------------------------------------------------------

  async readGuardDecisions(repoKey: string, scope?: string): Promise<GuardDecisions> {
    const rows = await this.db
      .select({ payload: decisions.payload })
      .from(decisions)
      .where(eq(decisions.scope, this.decisionsScope(repoKey, scope)))
      .limit(1);
    return rows[0] ? (rows[0].payload as GuardDecisions) : EMPTY_GUARD_DECISIONS;
  }

  async writeGuardDecisions(
    repoKey: string,
    guardDecisions: GuardDecisions,
    scope?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(decisions)
      .values({ scope: this.decisionsScope(repoKey, scope), payload: guardDecisions, updatedAt: now })
      .onConflictDoUpdate({ target: [decisions.scope], set: { payload: guardDecisions, updatedAt: now } });
  }

  async deleteGuardDecisions(repoKey: string, scope?: string): Promise<void> {
    await this.db.delete(decisions).where(eq(decisions.scope, this.decisionsScope(repoKey, scope)));
  }

  /** `guard:<repo>` for the repo row; `guard:<repo>#pr/<n>` for the `_pr/<n>` overlay. */
  private decisionsScope(repoKey: string, scope?: string): string {
    const m = /^_pr\/(\d+)$/.exec(scope ?? '');
    return m ? `guard:${repoKey}#pr/${m[1]}` : `guard:${repoKey}`;
  }
}

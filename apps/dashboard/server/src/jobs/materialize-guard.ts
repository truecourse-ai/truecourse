/**
 * The guard state a hosted generate reads and leaves — moved between the
 * store and an ephemeral clone.
 *
 * The generator reads and writes its state as FILES, so a job that runs it over
 * a throwaway clone has to put the stored state back where the generator reads
 * it before running, and lift what the generator wrote out again before the
 * clone goes:
 *
 *   IN  — the user's guard decisions (dismissed claims and flows), the current
 *         scenario set — every file of it: the manifest is what makes an
 *         unchanged section a skip and keeps scenario ids stable across runs,
 *         and the flows and claims beside it are what synthesis reconciles
 *         against — and the current report (the birth findings a no-op
 *         generate carries forward).
 *   OUT — the scenario tree, the report (flagged as the repo's guard BASELINE:
 *         the job only ever runs on the default branch), and every birth-finding
 *         transcript, which lives in a gitignored evidence dir the clone takes
 *         with it.
 *
 * The RUN job reads the same IN half (the baseline set is what it runs) and
 * leaves its own OUT: the run snapshot as the baseline run, and every
 * scenario's evidence bundle — the transcript and, for a browser run, the
 * screenshots and session video, which travel as bytes.
 *
 * The recipe, the dependency catalog and the interface catalog are NOT moved
 * here: they belong to setup's bundle, which the job materializes over
 * whatever the scenario set carried.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  guardDecisionsPath,
  guardWorldDirtyMarkerPath,
  manifestPath,
  scenariosDir,
  readManifest as readCloneManifest,
  readGuardResult as readCloneGuardResult,
  writeGuardResult as writeCloneGuardResult,
} from '@truecourse/guard-runner';
import {
  guardEvidencePaths,
  guardEvidenceVisual,
  type GuardGenerateReport,
  type GuardLatest,
} from '@truecourse/shared';
import {
  readGuardBaselineCommit,
  readGuardDecisions,
  readGuardResult,
  readManifest,
  readScenarioFile,
  saveScenarios,
  writeGuardEvidence,
  writeGuardLatest,
  writeGuardResult,
  writeGuardResultEvidence,
  writeGuardRunCoverage,
  type GuardRunCoverage,
  type RepoRef,
  type VersionProvenance,
} from '@truecourse/core/lib/guard-store';
import {
  readGuardRunFlowSummary,
  readGuardRunSectionSummary,
} from '@truecourse/core/commands/guard-read';
import { storedScenarioSetFiles } from '@truecourse/core/lib/guard-read-tree';
import { log } from '@truecourse/core/lib/logger';
import { assertSafeRel, safeJoin } from '@truecourse/core/lib/safe-path';

function writeFile(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/**
 * Put the repo's stored guard state into `treeDir`: the CURRENT scenario set
 * and report of the default branch (the newest version of each), or — with
 * `commitSha` — the newest stored at that exact commit, which is what a pull
 * request check starts from. Returns the commit the set came from, or `null`
 * when there is none: a first generate starts from nothing, which is fine,
 * and a check with no base stops.
 */
export async function materializeStoredGuardState(
  repoKey: string,
  treeDir: string,
  opts: { commitSha?: string } = {},
): Promise<string | null> {
  // The dashboard dismisses into the store; the generator reads the clone's
  // `scenarios/decisions.json`. Without this, every dismissed claim is
  // re-authored and its section stays held.
  const decisions = await readGuardDecisions(repoKey);
  if (decisions.dismissedClaims.length > 0 || decisions.dismissedFlows.length > 0) {
    writeFile(guardDecisionsPath(treeDir), JSON.stringify(decisions, null, 2) + '\n');
  }

  const baseline = opts.commitSha ?? (await readGuardBaselineCommit(repoKey));
  if (!baseline) return null;

  // Unpinned: the newest version of each, whatever commit it was written at —
  // the set rolled back to is what the next generate reconciles against, and
  // a rollback re-stores the report that set was born with beside it, so the
  // scope's newest report is its pair, or the blocked report of a generate
  // that stored no set, carried forward. Pinned: the newest at that commit,
  // and nothing when it holds no set.
  const at = opts.commitSha ? { commitSha: opts.commitSha } : {};
  const manifest = await readManifest(repoKey, at);
  if (opts.commitSha && !manifest) return null;
  if (manifest) writeFile(manifestPath(treeDir), JSON.stringify(manifest, null, 2) + '\n');
  // Every file of the set, not only the scenario yaml: the committed flows and
  // claims beside the manifest are what synthesis reconciles against, and a
  // clone without them makes every flow look new.
  for (const rel of await storedScenarioSetFiles(repoKey, treeDir, at)) {
    const body = await readScenarioFile(repoKey, rel, at);
    if (body == null) continue;
    assertSafeRel(rel);
    writeFile(safeJoin(treeDir, rel), body);
  }
  const report = await readGuardResult(repoKey, at);
  if (report) writeCloneGuardResult(treeDir, report);
  return baseline;
}

/**
 * Tell the engine the world it is about to boot is of UNKNOWN state. The
 * recipe's compose project is named after the (workspace, repository) pair, so
 * every job of that pair shares one project and its volumes — and the marker
 * that records a mutated world lives in the clone, which the job that mutated it
 * took with it. A fresh clone therefore starts dirty by declaration: the
 * engine's boot runs `api.services.reset` before `up` when the recipe has one,
 * and a run never inherits what an interrupted one left in the datastore.
 */
export function markWorldStateUnknown(treeDir: string): void {
  writeFile(guardWorldDirtyMarkerPath(treeDir), 'materialized: the shared world may carry an earlier job\'s state\n');
}

/** What persisting a generate left in the store. */
export interface PersistedGuardGenerate {
  /** Files in the saved scenario set (yaml + the root json files). */
  fileCount: number;
}

/**
 * Lift what a completed generate wrote in `treeDir` into the store as new
 * versions of `ref`'s series: the scenario tree, the report, then every
 * birth-finding transcript the report and the manifest point at. Both carry
 * `provenance` — the run that wrote them and its model. The report row is
 * written before the evidence, which attaches to it.
 */
export async function persistGeneratedGuard(
  ref: RepoRef,
  treeDir: string,
  report: GuardGenerateReport,
  provenance?: VersionProvenance,
): Promise<PersistedGuardGenerate> {
  const { fileCount } = await saveScenarios(ref, scenariosDir(treeDir), provenance);
  await writeGuardResult(ref, report, provenance);
  await persistBirthEvidence(ref, treeDir, report);
  return { fileCount };
}

/**
 * Copy EVERY transcript the generate left in the clone into the store. A birth
 * run persists no run row, so its evidence attaches to the generate report at
 * `ref`'s commit. The paths are enumerated from both stores that carry them —
 * the report's findings AND the manifest's durable diagnoses — because a
 * no-op generate re-derives its committed rows and only the manifest still
 * points at their transcripts. A pointer whose dir holds nothing is skipped: it
 * may name a run whose tree is long gone.
 */
async function persistBirthEvidence(
  ref: RepoRef,
  treeDir: string,
  report: GuardGenerateReport,
): Promise<void> {
  for (const evidencePath of guardEvidencePaths({ report, manifest: readCloneManifest(treeDir) })) {
    const files = collectEvidenceFiles(treeDir, evidencePath);
    if (!files) continue;
    const scenarioSeg = evidencePath.split('/').pop()!;
    await writeGuardResultEvidence(ref, scenarioSeg, files);
  }
}

/**
 * Lift a completed run out of `treeDir` into the store: the snapshot the runner
 * left as a run of `ref`'s scope (keyed by the clone's commit) with its
 * `provenance`, its SECTION and FLOW summaries, then every scenario's evidence
 * bundle, which attaches to that run row. The snapshot is written first, since
 * the evidence manifest lives on it, and the summaries are derived against the
 * run that is now stored — unless the caller hands them over (`coverage`), as
 * a pull request's check does: its flows are derived from the head's tree, and
 * its sections are nobody's trend.
 */
export async function persistGuardRun(
  ref: RepoRef,
  treeDir: string,
  run: GuardLatest,
  opts: { provenance?: VersionProvenance; coverage?: Pick<GuardRunCoverage, 'sections' | 'flows'> } = {},
): Promise<void> {
  // The stored record says where it ran: this is the hosted runner's run.
  const latest: GuardLatest = { ...run, run: { ...run.run, origin: 'hosted' } };
  await writeGuardLatest(ref.repoKey, latest, { scope: ref.scope, ...(opts.provenance ? { provenance: opts.provenance } : {}) });
  if (opts.coverage) {
    // Best-effort, as the derived one is: the run is stored; its coverage is a summary.
    try {
      await writeGuardRunCoverage(ref.repoKey, {
        runId: latest.run.runId,
        ranAt: latest.run.ranAt,
        commit: latest.run.commit,
        ...opts.coverage,
      });
    } catch (err) {
      log.warn(`[Guard] the coverage of ${ref.repoKey} run ${latest.run.runId} was not recorded: ${(err as Error).message}`);
    }
  } else {
    await recordGuardRunCoverage(ref.repoKey, latest);
  }
  const runId = latest.run.runId;
  for (const scenario of latest.scenarios) {
    if (!scenario.evidencePath) continue;
    const files = collectEvidenceFiles(treeDir, scenario.evidencePath);
    if (!files) continue;
    await writeGuardEvidence(ref.repoKey, runId, scenario.id, files);
  }
}

/**
 * Derive and store ONE run's coverage summaries, which is what Home reads a run
 * as: its SECTIONS, which the changes widget follows, and its FLOWS, which the
 * trend counts.
 *
 * The section summary is what puts the run in history at all — a run without one
 * (no document body to join, nothing the scenario set names) is left out and said
 * so, and nothing is guessed in its place. The flow summary is allowed to be
 * absent on its own: a repository whose flow corpus cannot be read still has a
 * run worth recording, and it is simply not a point of the flow trend. Never
 * fails the run that produced it.
 */
export async function recordGuardRunCoverage(
  repoKey: string,
  latest: GuardLatest,
): Promise<boolean> {
  try {
    const sections = await readGuardRunSectionSummary(repoKey, latest);
    if (!sections) {
      log.warn(
        `[Guard] no section summary could be derived for ${repoKey} run ${latest.run.runId}; it stays out of the trend`,
      );
      return false;
    }
    const flows = await readGuardRunFlowSummary(repoKey, latest);
    if (!flows) {
      log.warn(
        `[Guard] no flow summary could be derived for ${repoKey} run ${latest.run.runId}; it stays out of the flow trend`,
      );
    }
    // An empty summary records that there was nothing to derive, so the Home
    // read never re-derives this run; null would mean "try again".
    await writeGuardRunCoverage(repoKey, {
      runId: latest.run.runId,
      ranAt: latest.run.ranAt,
      commit: latest.run.commit,
      sections,
      flows: flows ?? {},
    });
    return true;
  } catch (err) {
    log.warn(
      `[Guard] the coverage summary for ${repoKey} run ${latest.run.runId} failed: ${(err as Error).message}`,
    );
    return false;
  }
}

/**
 * An evidence dir as `{ fileName: body }`, or null when it holds no regular
 * file. A visual artifact (a screenshot, the session video) is read as BYTES —
 * decoded as text it would be a corrupted file; everything else is the text
 * it is.
 */
function collectEvidenceFiles(
  treeDir: string,
  evidencePath: string,
): Record<string, string | Buffer> | null {
  const dir = path.join(treeDir, evidencePath);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const files: Record<string, string | Buffer> = {};
  for (const name of names) {
    const file = path.join(dir, name);
    if (!fs.statSync(file).isFile()) continue;
    files[name] = guardEvidenceVisual(name) ? fs.readFileSync(file) : fs.readFileSync(file, 'utf-8');
  }
  return Object.keys(files).length > 0 ? files : null;
}

/** The report the generate left in the clone — it carries the usage totals the
 *  driver stamped — or null when the run wrote none. */
export function readGeneratedReport(treeDir: string): GuardGenerateReport | null {
  return readCloneGuardResult(treeDir);
}

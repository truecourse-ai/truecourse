/**
 * The guard state a hosted generate reads and leaves — moved between the
 * store and an ephemeral clone.
 *
 * The generator is file-based by design (its outputs are committable in a
 * working-tree product), so a job that runs it over a throwaway clone has to
 * put the stored state back where the generator reads it before running, and
 * lift what the generator wrote out again before the clone goes:
 *
 *   IN  — the user's guard decisions (dismissed claims and flows), the baseline
 *         scenario set (the manifest is what makes an unchanged section a skip
 *         and keeps scenario ids stable across runs) and the baseline report
 *         (the birth findings a no-op generate carries forward).
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
  listScenarioFiles,
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
  type RepoRef,
} from '@truecourse/core/lib/guard-store';
import { assertSafeRel, safeJoin } from '@truecourse/core/lib/safe-path';

function writeFile(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/**
 * Put the repo's stored guard state into `treeDir`. Returns the baseline
 * commit the scenario set came from, or `null` when the repo has never
 * generated — a first generate starts from nothing, which is fine.
 */
export async function materializeStoredGuardState(
  repoKey: string,
  treeDir: string,
): Promise<string | null> {
  // The dashboard dismisses into the store; the generator reads the clone's
  // `scenarios/decisions.json`. Without this, every dismissed claim is
  // re-authored and its section stays held.
  const decisions = await readGuardDecisions(repoKey);
  if (decisions.dismissedClaims.length > 0 || decisions.dismissedFlows.length > 0) {
    writeFile(guardDecisionsPath(treeDir), JSON.stringify(decisions, null, 2) + '\n');
  }

  const baseline = await readGuardBaselineCommit(repoKey);
  if (!baseline) return null;

  const manifest = await readManifest(repoKey, baseline);
  if (manifest) writeFile(manifestPath(treeDir), JSON.stringify(manifest, null, 2) + '\n');
  for (const rel of await listScenarioFiles(repoKey, baseline)) {
    const body = await readScenarioFile(repoKey, rel, baseline);
    if (body == null) continue;
    assertSafeRel(rel);
    writeFile(safeJoin(treeDir, rel), body);
  }
  const report = await readGuardResult(repoKey, baseline);
  if (report) writeCloneGuardResult(treeDir, report);
  return baseline;
}

/** What persisting a generate left in the store. */
export interface PersistedGuardGenerate {
  /** Files in the saved scenario set (yaml + the root json files). */
  fileCount: number;
}

/**
 * Lift what a completed generate wrote in `treeDir` into the store under
 * `ref`: the scenario tree, the report (baseline), then every birth-finding
 * transcript the report and the manifest point at. The report row is written
 * before the evidence, which attaches to it.
 */
export async function persistGeneratedGuard(
  ref: RepoRef,
  treeDir: string,
  report: GuardGenerateReport,
): Promise<PersistedGuardGenerate> {
  const { fileCount } = await saveScenarios(ref, scenariosDir(treeDir));
  await writeGuardResult(ref, report, { baseline: true });
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
 * left as the repo's BASELINE run (keyed by the clone's commit), then every
 * scenario's evidence bundle, which attaches to that run row. The snapshot is
 * written first — the evidence manifest lives on it.
 */
export async function persistGuardRun(
  ref: RepoRef,
  treeDir: string,
  run: GuardLatest,
): Promise<void> {
  // The stored record says where it ran: this is the hosted runner's run.
  const latest: GuardLatest = { ...run, run: { ...run.run, origin: 'hosted' } };
  await writeGuardLatest(ref.repoKey, latest);
  const runId = latest.run.runId;
  for (const scenario of latest.scenarios) {
    if (!scenario.evidencePath) continue;
    const files = collectEvidenceFiles(treeDir, scenario.evidencePath);
    if (!files) continue;
    await writeGuardEvidence(ref.repoKey, runId, scenario.id, files);
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

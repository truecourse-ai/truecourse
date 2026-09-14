/**
 * A `GuardStore` backed by a working TREE — the test double every engine and
 * route test installs.
 *
 * Production has exactly one store, Postgres. But a run's engine writes its
 * guard documents into a working tree, so a test that drives the engine over a
 * temp repo and then reads the result through the seam is best served by a
 * store that IS that tree. Nothing here ships: it lives in `tests/` precisely
 * because it is a stand-in for the stored state a job would have materialized.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  appendGuardHistory as fileAppendGuardHistory,
  evidenceRelPath,
  evidenceRunDir,
  evidenceScenarioDir,
  guardDir,
  guardRunPath,
  loadScenarios as fileLoadScenarios,
  readGuardDecisions as fileReadGuardDecisions,
  readGuardHistory as fileReadGuardHistory,
  readGuardLatest as fileReadGuardLatest,
  readGuardResult as fileReadGuardResult,
  readManifest as fileReadManifest,
  recipePath,
  scenariosDir,
  walkScenarioRelFiles,
  writeGuardDecisions as fileWriteGuardDecisions,
  writeGuardLatest as fileWriteGuardLatest,
  writeGuardResult as fileWriteGuardResult,
  writeGuardRun as fileWriteGuardRun,
  type LoadedScenarios,
} from '@truecourse/guard-runner';
import { GuardLatestSchema } from '@truecourse/shared';
import type {
  GuardDecisions,
  GuardGenerateReport,
  GuardHistory,
  GuardHistoryEntry,
  GuardLatest,
  GuardManifest,
} from '@truecourse/shared';
import {
  setGuardStore as setGuardStoreByPackage,
  resetGuardStore as resetGuardStoreByPackage,
  type GuardRunSections,
  type GuardStore,
  type RepoRef,
  type SaveScenariosResult,
  type WrittenGuardRun,
} from '@truecourse/core/lib/guard-store';
import {
  setGuardStore as setGuardStoreBySource,
  resetGuardStore as resetGuardStoreBySource,
} from '../../packages/core/src/lib/guard-store';
import { collectGuardSetupBundle } from '@truecourse/core/services/guard-setup/bundle';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Run ids, evidence filenames, scenario-dir names — no separators, no `..`. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * The commit this store answers as its baseline. The tree holds exactly one
 * state, so every read here ignores the commit it is given; the constant exists
 * only so a view's scope RESOLVES rather than coming back empty.
 */
export const WORK_TREE_COMMIT = 'worktree';

/** Where the file store keeps a run's section summary: `guard/sections/<runId>.json`. */
const SECTIONS_DIR = 'sections';

function guardSectionsPath(repoPath: string, runId: string): string {
  return path.join(guardDir(repoPath), SECTIONS_DIR, `${runId}.json`);
}

/**
 * Resolve a repo-relative evidence directory INSIDE the guard evidence root, or
 * `null` when it points anywhere else. The one confinement every dir-addressed
 * evidence read shares — a `../`-laced pointer can never escape it, whether the
 * caller went on to read text, bytes, or the listing.
 */
function confinedEvidenceDir(repoPath: string, evidenceDir: string): string | null {
  const evidenceRoot = path.resolve(guardDir(repoPath), 'evidence');
  const dir = path.resolve(repoPath, evidenceDir);
  if (dir !== evidenceRoot && !dir.startsWith(evidenceRoot + path.sep)) return null;
  return dir;
}

/**
 * The absolute path of one evidence file, or `null` for an unsafe file name, a
 * directory outside the evidence root, or a path that is not an existing file.
 */
function confinedEvidenceFile(
  repoPath: string,
  evidenceDir: string,
  file: string,
): string | null {
  if (!SAFE_SEGMENT.test(file)) return null;
  const dir = confinedEvidenceDir(repoPath, evidenceDir);
  if (dir == null) return null;
  const full = path.resolve(dir, file);
  if (!full.startsWith(dir + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

/** Recursively collect `*.yaml` / `*.yml` under `dir` (absolute paths, sorted). */
function collectYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectYamlFiles(full));
    else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Tree-backed store — the synchronous guard-runner fs under the async store
// surface, reading and writing the work tree in place.
// ---------------------------------------------------------------------------

export class WorkTreeGuardStore implements GuardStore {
  async readGuardLatest(repoPath: string): Promise<GuardLatest | null> {
    return fileReadGuardLatest(repoPath);
  }

  async writeGuardLatest(repoPath: string, latest: GuardLatest): Promise<void> {
    fileWriteGuardLatest(repoPath, latest);
  }

  async writeGuardRun(repoPath: string, latest: GuardLatest): Promise<WrittenGuardRun> {
    fileWriteGuardRun(repoPath, latest);
    return { runId: latest.run.runId, latest };
  }

  async readGuardRun(repoPath: string, runId: string): Promise<GuardLatest | null> {
    if (!SAFE_SEGMENT.test(runId)) return null;
    const file = guardRunPath(repoPath, runId);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = GuardLatestSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  // The file store keeps one materialized snapshot (LATEST) — the exact-commit
  // read is a match against its envelope, not a scan of runs/ or history.
  async readGuardRunForCommit(repoPath: string, commitSha: string): Promise<GuardLatest | null> {
    const latest = fileReadGuardLatest(repoPath);
    if (!latest) return null;
    // The tree's OWN commit names the state the tree holds, whatever the run
    // snapshot in it happens to record as its commit; any other commit is a
    // match against that envelope.
    return commitSha === WORK_TREE_COMMIT || latest.run.commit === commitSha ? latest : null;
  }

  async readGuardHistory(repoPath: string): Promise<GuardHistory> {
    return fileReadGuardHistory(repoPath);
  }

  async appendGuardHistory(repoPath: string, entry: GuardHistoryEntry): Promise<void> {
    fileAppendGuardHistory(repoPath, entry);
  }

  // The section summaries live beside the run snapshots, one derived file per
  // run: `guard/sections/<runId>.json`, gitignored like `guard/runs/`.
  async writeGuardRunSections(repoPath: string, run: GuardRunSections): Promise<void> {
    if (!SAFE_SEGMENT.test(run.runId)) return;
    const file = guardSectionsPath(repoPath, run.runId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(run, null, 2) + '\n');
  }

  async readGuardRunSections(repoPath: string): Promise<GuardRunSections[]> {
    const dir = path.join(guardDir(repoPath), SECTIONS_DIR);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const runs: GuardRunSections[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')) as GuardRunSections;
        if (parsed && typeof parsed.runId === 'string' && parsed.sections) runs.push(parsed);
      } catch {
        // A half-written or hand-edited file names no run.
      }
    }
    return runs.sort((a, b) => a.ranAt.localeCompare(b.ranAt) || a.runId.localeCompare(b.runId));
  }

  // The file impl reads the live store — there is no per-commit history, so
  // `commitSha` is ignored (OSS is latest). Same for the corpus reads below.
  async readGuardResult(repoKey: string, _commitSha?: string): Promise<GuardGenerateReport | null> {
    return fileReadGuardResult(repoKey);
  }

  async writeGuardResult(ref: RepoRef, report: GuardGenerateReport): Promise<void> {
    fileWriteGuardResult(ref.repoKey, report);
  }

  // The tree IS the one stored state, so it is its own baseline. A view resolves
  // its read scope through this commit and every read below ignores the value —
  // answering `null` would instead make every view read an EMPTY scope and see
  // nothing, which is not what a materialized tree holds.
  async readGuardBaselineCommit(): Promise<string | null> {
    return WORK_TREE_COMMIT;
  }

  async writeGuardEvidence(
    repoPath: string,
    runId: string,
    scenarioId: string,
    files: Record<string, string | Buffer>,
  ): Promise<string> {
    const dir = evidenceScenarioDir(repoPath, runId, scenarioId);
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      if (!SAFE_SEGMENT.test(file)) {
        throw new Error(`[guard-store] unsafe evidence file name: ${file}`);
      }
      fs.writeFileSync(path.join(dir, file), content);
    }
    return evidenceRelPath(runId, scenarioId);
  }

  async readGuardEvidence(
    repoPath: string,
    runId: string,
    scenarioId: string,
    file: string,
  ): Promise<string | null> {
    if (!SAFE_SEGMENT.test(runId) || !SAFE_SEGMENT.test(file)) return null;
    const full = path.resolve(evidenceScenarioDir(repoPath, runId, scenarioId), file);
    const runDir = path.resolve(evidenceRunDir(repoPath, runId));
    if (full !== runDir && !full.startsWith(runDir + path.sep)) return null;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return fs.readFileSync(full, 'utf-8');
  }

  async readGuardEvidenceAt(
    repoPath: string,
    evidenceDir: string,
    file: string,
  ): Promise<string | null> {
    const full = confinedEvidenceFile(repoPath, evidenceDir, file);
    return full == null ? null : fs.readFileSync(full, 'utf-8');
  }

  async listGuardEvidenceAt(repoPath: string, evidenceDir: string): Promise<string[]> {
    const dir = confinedEvidenceDir(repoPath, evidenceDir);
    if (dir == null || !fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  }

  async readGuardEvidenceBytesAt(
    repoPath: string,
    evidenceDir: string,
    file: string,
  ): Promise<Buffer | null> {
    const full = confinedEvidenceFile(repoPath, evidenceDir, file);
    return full == null ? null : fs.readFileSync(full);
  }

  async writeGuardResultEvidence(): Promise<void> {
    // No-op: OSS birth evidence already lives in the working tree under
    // `.truecourse/guard/evidence/`, where `readGuardEvidenceAt` reads it directly.
    // Only the hosted store (ephemeral checkout) must copy it out.
  }

  async saveScenarios(ref: RepoRef, _sourceDir: string): Promise<SaveScenariosResult> {
    // The corpus is already on disk (the guard-runner/generator wrote it in place),
    // so there is nothing to copy — report the count, matching the contract store.
    // The commit is ignored: OSS has no per-commit history.
    return { fileCount: walkScenarioRelFiles(scenariosDir(ref.repoKey)).length };
  }

  async loadScenarios(ref: RepoRef): Promise<LoadedScenarios> {
    return fileLoadScenarios(ref.repoKey);
  }

  async readManifest(repoKey: string, _commitSha?: string): Promise<GuardManifest | null> {
    return fileReadManifest(repoKey);
  }

  async readRecipeRaw(repoKey: string, _commitSha?: string): Promise<string | null> {
    const file = recipePath(repoKey);
    if (!fs.existsSync(file)) return null;
    try {
      return fs.readFileSync(file, 'utf-8');
    } catch {
      return null;
    }
  }

  async listScenarioFiles(repoKey: string, _commitSha?: string): Promise<string[]> {
    return collectYamlFiles(scenariosDir(repoKey))
      .map((f) => path.relative(repoKey, f).split(path.sep).join('/'))
      .sort();
  }

  async readScenarioFile(repoKey: string, relPath: string, _commitSha?: string): Promise<string | null> {
    const root = path.resolve(scenariosDir(repoKey));
    const full = path.resolve(repoKey, relPath);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return fs.readFileSync(full, 'utf-8');
  }

  async saveGuardSetupBundle(): Promise<void> {
    // No-op: setup wrote these files into the working tree, which is the store.
  }

  // Setup's durable outputs are files in the tree, so the bundle IS what the
  // collector reads out of it — the recipe, the dependency catalog, both halves
  // of the interface catalog and the setup report. A reader that materializes
  // the bundle into a scratch tree therefore sees exactly what this tree holds.
  async loadGuardSetupBundle(repoKey: string): Promise<Record<string, string> | null> {
    const files = collectGuardSetupBundle(repoKey);
    return Object.keys(files).length > 0 ? files : null;
  }

  async readGuardDecisions(repoPath: string): Promise<GuardDecisions> {
    return fileReadGuardDecisions(repoPath);
  }

  async writeGuardDecisions(repoPath: string, decisions: GuardDecisions): Promise<void> {
    fileWriteGuardDecisions(repoPath, decisions);
  }
}

/**
 * Install the tree-backed store for a suite. Pair with {@link resetGuardStore}.
 *
 * The seam is installed through BOTH specifiers a test can reach it by — the
 * package (`@truecourse/core/lib/guard-store`, which resolves to the built
 * `dist`) and the source path — because a test may import the code under test
 * either way, and the two are separate module instances with separate state.
 */
export function installWorkTreeGuardStore(): WorkTreeGuardStore {
  const store = new WorkTreeGuardStore();
  setGuardStoreByPackage(store);
  setGuardStoreBySource(store);
  return store;
}

export function resetGuardStore(): void {
  resetGuardStoreByPackage();
  resetGuardStoreBySource();
}

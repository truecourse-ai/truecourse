/**
 * The pluggable guard store seam (`FileGuardStore`, the OSS default) — the guard
 * analogue of the verify/contract/spec store tests. Exercises the `GuardStore`
 * interface through its public delegators against a temp repo: run-state
 * round-trips (LATEST / runs / history / result), evidence write+read by run,
 * the scenario corpus (save/load/list/read/manifest/recipe), and decisions.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getGuardStore,
  resetGuardStore,
  readGuardLatest,
  writeGuardLatest,
  writeGuardRun,
  readGuardRun,
  readGuardRunForCommit,
  readGuardHistory,
  appendGuardHistory,
  readGuardResult,
  writeGuardResult,
  writeGuardEvidence,
  readGuardEvidence,
  readGuardEvidenceAt,
  saveScenarios,
  loadScenarios,
  readManifest,
  readRecipeRaw,
  listScenarioFiles,
  readScenarioFile,
  readGuardDecisions,
  writeGuardDecisions,
  deleteGuardDecisions,
} from '../../packages/core/src/lib/guard-store';
import type {
  GuardDecisions,
  GuardGenerateReport,
  GuardHistoryEntry,
  GuardLatest,
  GuardManifest,
} from '../../packages/shared/src/index';
import { guardManifestSections } from '../../packages/shared/src/index';

const SCENARIOS_REL = path.join('.truecourse', 'scenarios');

/** A minimal valid v2 scenario YAML bound to (doc, section). */
function scenarioYaml(id: string, doc: string, section: string): string {
  return [
    'guard: 3',
    `id: ${id}`,
    `title: ${id} does its thing`,
    'binds:',
    `  - doc: ${doc}`,
    `    section: ${section}`,
    '    fingerprint: sha256:abc',
    'driver: cli',
    'steps:',
    '  - run: ["--version"]',
    '    expect:',
    '      exit: 0',
  ].join('\n') + '\n';
}

/** Seed the on-disk scenario corpus (one yaml + recipe + manifest + decisions). */
function seedCorpus(r: string): void {
  const dir = path.join(r, SCENARIOS_REL, 'cli');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'version.1.yaml'), scenarioYaml('version.1', 'docs/cli.md', 'version'));
  fs.writeFileSync(
    path.join(r, SCENARIOS_REL, 'recipe.json'),
    JSON.stringify({ build: 'pnpm build', entry: ['node', 'dist/cli.js'] }, null, 2),
  );
  const manifest: GuardManifest = {
    version: 3,
    flows: [
      {
        flowId: 'docs/cli.md#version',
        flowFingerprint: 'sha256:abc',
        bindings: [{ doc: 'docs/cli.md', anchor: 'version', fingerprint: 'sha256:abc' }],
        scenarios: [{ id: 'version.1', surface: 'cli' }],
        generationInputsHash: null,
        gaps: [],
      },
    ],
  };
  fs.writeFileSync(path.join(r, SCENARIOS_REL, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // decisions.json lives in the tree but is NOT a scenario body — it must be
  // excluded from saveScenarios' fileCount (matches the EE walker's predicate).
  fs.writeFileSync(
    path.join(r, SCENARIOS_REL, 'decisions.json'),
    JSON.stringify({ version: 1, dismissedClaims: [], dismissedFlows: [] }, null, 2),
  );
}

/** The file store ignores the commit — OSS is the live working tree. */
const refFor = (r: string) => ({ repoKey: r, commitSha: '' });

const repos: string[] = [];
beforeEach(() => resetGuardStore());
afterEach(() => {
  resetGuardStore();
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});
function repo(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-store-'));
  repos.push(r);
  return r;
}

function makeLatest(runId: string): GuardLatest {
  return {
    run: {
      runId,
      ranAt: new Date().toISOString(),
      branch: 'main',
      commit: 'abc123',
      recipeFingerprint: 'sha256:deadbeef',
      scenarioFormat: 3,
    },
    summary: { total: 2, pass: 1, fail: 1, stale: 0, orphaned: 0, error: 0, blocked: 0 },
    scenarios: [],
    sections: [],
  };
}

function entryFrom(latest: GuardLatest): GuardHistoryEntry {
  return {
    runId: latest.run.runId,
    ranAt: latest.run.ranAt,
    branch: latest.run.branch,
    commit: latest.run.commit,
    summary: latest.summary,
  };
}

function report(): GuardGenerateReport {
  return {
    generatedAt: '2026-01-04T00:00:00.000Z',
    status: 'ok',
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  };
}

// ---------------------------------------------------------------------------
// Run-state — LATEST / runs / history / result, through the store delegators.
// ---------------------------------------------------------------------------

describe('FileGuardStore — run state', () => {
  it('materializes in place (OSS file store)', () => {
    expect(getGuardStore().materializesInPlace).toBe(true);
  });

  it('round-trips LATEST and returns null when absent', async () => {
    const r = repo();
    expect(await readGuardLatest(r)).toBeNull();
    const latest = makeLatest('2026-01-03T00-00-00Z_cccccccc');
    await writeGuardLatest(r, latest);
    expect(await readGuardLatest(r)).toEqual(latest);
  });

  it('writes a run snapshot and reads it back by runId', async () => {
    const r = repo();
    const runId = '2026-01-02T03-04-05Z_abcd1234';
    const latest = makeLatest(runId);
    const written = await writeGuardRun(r, latest);
    expect(written.runId).toBe(runId);
    expect(written.latest).toEqual(latest);
    expect(await readGuardRun(r, runId)).toEqual(latest);
  });

  it('returns null for an unknown, unsafe, or traversal run id', async () => {
    const r = repo();
    expect(await readGuardRun(r, 'nope')).toBeNull();
    expect(await readGuardRun(r, '../../etc/passwd')).toBeNull();
    expect(await readGuardRun(r, 'a/b')).toBeNull();
  });

  it('readGuardRunForCommit returns LATEST when its envelope commit matches', async () => {
    const r = repo();
    const latest = makeLatest('2026-01-05T00-00-00Z_dddddddd'); // run.commit = 'abc123'
    await writeGuardLatest(r, latest);
    expect(await readGuardRunForCommit(r, 'abc123')).toEqual(latest);
  });

  it('readGuardRunForCommit returns null on a commit mismatch or missing LATEST', async () => {
    const r = repo();
    // No LATEST at all → null (never a match).
    expect(await readGuardRunForCommit(r, 'abc123')).toBeNull();
    const latest = makeLatest('2026-01-05T00-00-00Z_eeeeeeee'); // run.commit = 'abc123'
    await writeGuardLatest(r, latest);
    expect(await readGuardRunForCommit(r, 'other-sha')).toBeNull();
  });

  it('appends history across two runs, preserving order', async () => {
    const r = repo();
    const a = makeLatest('2026-01-01T00-00-00Z_aaaaaaaa');
    const b = makeLatest('2026-01-02T00-00-00Z_bbbbbbbb');
    await appendGuardHistory(r, entryFrom(a));
    await appendGuardHistory(r, entryFrom(b));
    const history = await readGuardHistory(r);
    expect(history.runs.map((e) => e.runId)).toEqual([a.run.runId, b.run.runId]);
  });

  it('reads {runs: []} for a missing history file', async () => {
    expect(await readGuardHistory(repo())).toEqual({ runs: [] });
  });

  it('round-trips the generate report and returns null when absent', async () => {
    const r = repo();
    expect(await readGuardResult(r)).toBeNull();
    const rep = report();
    // Writes take a RepoRef (contract-store convention); the file store ignores
    // the commit — there is one live result.json regardless of commit.
    await writeGuardResult(refFor(r), rep);
    expect(await readGuardResult(r)).toEqual(rep);
    // A commit-qualified read is the same live file (OSS has no per-commit history).
    expect(await readGuardResult(r, 'abc123')).toEqual(rep);
  });
});

// ---------------------------------------------------------------------------
// Evidence — write a per-scenario transcript and read it back by run.
// ---------------------------------------------------------------------------

describe('FileGuardStore — evidence', () => {
  const RUN = '2026-07-08T00-00-00Z_abc12345';
  const SCN = 'version.1';

  it('writes an evidence file map and returns the repo-relative pointer', async () => {
    const r = repo();
    const rel = await writeGuardEvidence(r, RUN, SCN, {
      'transcript.txt': 'the full transcript\n',
      'stdout.txt': 'stdout body\n',
    });
    expect(rel).toBe(`.truecourse/guard/evidence/${RUN}/${SCN}`);
    expect(await readGuardEvidence(r, RUN, SCN, 'transcript.txt')).toBe('the full transcript\n');
    expect(await readGuardEvidence(r, RUN, SCN, 'stdout.txt')).toBe('stdout body\n');
  });

  it('reads evidence addressed by its evidence dir, and refuses traversal', async () => {
    const r = repo();
    const rel = await writeGuardEvidence(r, RUN, SCN, { 'transcript.txt': 'body\n' });
    expect(await readGuardEvidenceAt(r, rel, 'transcript.txt')).toBe('body\n');
    // Missing file, unsafe filename, and an escape outside guard/evidence → null.
    expect(await readGuardEvidenceAt(r, rel, 'nope.txt')).toBeNull();
    expect(await readGuardEvidenceAt(r, rel, '../../secret')).toBeNull();
    expect(await readGuardEvidence(r, '../../etc', SCN, 'passwd')).toBeNull();
    expect(await readGuardEvidenceAt(r, '.truecourse/guard/evidence/../../..', 'package.json')).toBeNull();
  });

  it('rejects an unsafe evidence file name on write', async () => {
    const r = repo();
    await expect(writeGuardEvidence(r, RUN, SCN, { '../escape': 'x' })).rejects.toThrow(/unsafe evidence/);
  });
});

// ---------------------------------------------------------------------------
// Scenario corpus — save/load/list/read + manifest + recipe.
// ---------------------------------------------------------------------------

describe('FileGuardStore — scenario corpus', () => {
  it('saveScenarios reports the scenario-set file count (decisions.json excluded)', async () => {
    const r = repo();
    seedCorpus(r);
    const { fileCount } = await saveScenarios(refFor(r), path.join(r, SCENARIOS_REL));
    // one yaml + recipe.json + manifest.json — the seeded decisions.json is not a
    // scenario body (it routes to the decisions store) and must not be counted,
    // matching the EE walker's predicate.
    expect(fileCount).toBe(3);
  });

  it('saveScenarios counts only top-level recipe/manifest json (nested json ignored)', async () => {
    const r = repo();
    seedCorpus(r);
    // A nested manifest.json (not at the scenarios root) is not part of the set.
    fs.writeFileSync(path.join(r, SCENARIOS_REL, 'cli', 'manifest.json'), '{}');
    const { fileCount } = await saveScenarios(refFor(r), path.join(r, SCENARIOS_REL));
    expect(fileCount).toBe(3);
  });

  it('loadScenarios parses the committed scenarios', async () => {
    const r = repo();
    seedCorpus(r);
    const { scenarios, errors } = await loadScenarios(refFor(r));
    expect(errors).toEqual([]);
    expect(scenarios.map((s) => s.id)).toEqual(['version.1']);
    expect(scenarios[0].binds[0]).toMatchObject({ doc: 'docs/cli.md', section: 'version' });
  });

  it('readManifest returns the bound flows; null when absent', async () => {
    const r = repo();
    expect(await readManifest(r)).toBeNull();
    seedCorpus(r);
    const manifest = await readManifest(r);
    expect(manifest?.flows.map((f) => f.flowId)).toEqual(['docs/cli.md#version']);
    expect(guardManifestSections(manifest ?? null).map((s) => s.anchor)).toEqual(['version']);
  });

  it('readRecipeRaw returns the raw recipe.json; null when absent', async () => {
    const r = repo();
    expect(await readRecipeRaw(r)).toBeNull();
    seedCorpus(r);
    const raw = await readRecipeRaw(r);
    expect(JSON.parse(raw!)).toMatchObject({ build: 'pnpm build', entry: ['node', 'dist/cli.js'] });
  });

  it('lists scenario YAMLs repo-relative and reads one by path; refuses traversal', async () => {
    const r = repo();
    seedCorpus(r);
    const files = await listScenarioFiles(r);
    expect(files).toEqual(['.truecourse/scenarios/cli/version.1.yaml']);
    const content = await readScenarioFile(r, files[0]);
    expect(content).toContain('id: version.1');
    // A path outside the scenarios dir is refused even if it exists.
    fs.writeFileSync(path.join(r, 'secret.txt'), 'nope');
    expect(await readScenarioFile(r, 'secret.txt')).toBeNull();
    expect(await readScenarioFile(r, '../secret.txt')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Decisions — repo round-trip + delete; a PR scope is enterprise-only.
// ---------------------------------------------------------------------------

describe('FileGuardStore — decisions', () => {
  const claim = {
    doc: 'docs/cli.md',
    anchor: 'version',
    title: 'the --version flag prints the semver',
    dismissedAt: '2026-07-08T00:00:00.000Z',
  };

  it('reads an empty decisions file by default, round-trips a write, and deletes it', async () => {
    const r = repo();
    expect(await readGuardDecisions(r)).toEqual({ version: 1, dismissedClaims: [], dismissedFlows: [] });

    const decisions: GuardDecisions = { version: 1, dismissedClaims: [claim], dismissedFlows: [] };
    await writeGuardDecisions(r, decisions);
    expect(await readGuardDecisions(r)).toEqual(decisions);

    await deleteGuardDecisions(r);
    expect(await readGuardDecisions(r)).toEqual({ version: 1, dismissedClaims: [], dismissedFlows: [] });
    // delete is idempotent (no throw when already absent)
    await expect(deleteGuardDecisions(r)).resolves.toBeUndefined();
  });

  it('rejects a PR-scoped decisions read/write/delete on the file store', async () => {
    const r = repo();
    await expect(readGuardDecisions(r, '_pr/7')).rejects.toThrow(/enterprise store/);
    await expect(
      writeGuardDecisions(r, { version: 1, dismissedClaims: [], dismissedFlows: [] }, '_pr/7'),
    ).rejects.toThrow(/enterprise store/);
    await expect(deleteGuardDecisions(r, '_pr/7')).rejects.toThrow(/enterprise store/);
  });
});

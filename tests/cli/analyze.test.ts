import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Socket emits call getIO() which throws without an active socket server.
// Stub only the emit helpers + trackers; pass every other export (domain
// constants, StepTracker, etc.) through so violation-pipeline etc. keep
// working.
vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  class NoopTracker {
    start() {}
    done() {}
    error() {}
    detail() {}
  }
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    createSocketTracker: () => new NoopTracker(),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
  };
});

import { analyzeInProcess } from '../../packages/core/src/commands/analyze-in-process';
import {
  readLatest,
  readHistory,
  listAnalyses,
  clearLatestCache,
} from '../../packages/core/src/lib/analysis-store';
import {
  registerProject,
  unregisterProject,
  getProjectBySlug,
  type RegistryEntry,
} from '../../packages/core/src/config/registry';
import { updateProjectConfig } from '../../packages/core/src/config/project-config';
import {
  suggestInvariants,
  acceptDraft,
} from '../../packages/core/src/services/invariants';
import { readAllActiveInvariants } from '../../packages/core/src/lib/invariant-store';
import { createLLMProvider } from '../../packages/core/src/services/llm/provider';
import {
  parseInvariantDriftMarkers,
  type ExpectedInvariantDrift,
} from '../_shared/markers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = path.resolve(__dirname, '../fixtures/sample-js-project-negative');
const FIXTURE_POSITIVE = path.resolve(__dirname, '../fixtures/sample-js-project-positive');

/**
 * Live LLM tests are gated behind `LLM_TESTS=1` because they make real Claude
 * calls (slow + nonzero cost). Default CI run skips the gated block; local
 * verification + dedicated CI jobs run with the env set.
 */
const LLM_TESTS = process.env.LLM_TESTS === '1';

/**
 * Copy a directory recursively, skipping `.truecourse/` so fixture pollution
 * from a prior run can't leak into a fresh test invocation.
 */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.truecourse' || entry.name === 'node_modules' || entry.name === '.git') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * Copy a fixture into a throwaway tmpdir + initialize an empty git repo so
 * `analyzeInProcess` can collect branch/commit metadata. Shared across the
 * deterministic e2e block and the gated live-LLM blocks.
 */
function setupFixtureWorkdir(src: string): string {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-e2e-analyze-'));
  copyDir(src, wd);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 't@t',
  };
  execSync('git init -q -b main', { cwd: wd, env });
  execSync('git add -A', { cwd: wd, env });
  execSync('git -c commit.gpgsign=false commit -q -m init', { cwd: wd, env });
  return wd;
}

describe('CLI analyze pipeline (e2e)', () => {
  let workDir: string;
  let project: RegistryEntry;

  beforeAll(async () => {
    workDir = setupFixtureWorkdir(FIXTURE_SRC);
    project = registerProject(workDir);

    // Disable LLM rules so the pipeline is deterministic and network-free.
    // Config takes precedence over the override inside analyze-core, so we
    // set it here to be explicit about what's exercised.
    updateProjectConfig(workDir, { enableLlmRules: false });

    clearLatestCache();
  }, 30_000);

  afterAll(() => {
    if (project) unregisterProject(project.slug);
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    clearLatestCache();
  });

  it('writes a complete store and populates the registry', async () => {
    const result = await analyzeInProcess(project, { enableLlmRulesOverride: false });
    expect(result.analysisId).toBeTruthy();
    expect(result.serviceCount).toBeGreaterThan(0);

    const latest = readLatest(workDir);
    expect(latest).not.toBeNull();
    expect(latest!.head).toBe(result.filename);
    expect(latest!.analysis.id).toBe(result.analysisId);
    expect(latest!.analysis.status).toBe('completed');
    expect(latest!.graph.services.length).toBeGreaterThan(0);
    expect(latest!.graph.modules.length).toBeGreaterThan(0);
    expect(latest!.graph.methods.length).toBeGreaterThan(0);
    expect(latest!.violations.length).toBeGreaterThan(0);

    // Sanity: a stable rule key from a `// VIOLATION:` marker in the fixture
    // should appear in the materialized violation set. If the rule catalog
    // renames this key, update the marker + assertion together.
    const ruleKeys = new Set(latest!.violations.map((v) => v.ruleKey));
    expect(ruleKeys.has('code-quality/deterministic/missing-return-type')).toBe(true);

    // Per-analysis snapshot file exists and its filename matches LATEST.head.
    const analysisFiles = listAnalyses(workDir);
    expect(analysisFiles).toHaveLength(1);
    expect(analysisFiles[0]).toBe(latest!.head);

    // History has exactly one entry for the run.
    const history = readHistory(workDir);
    expect(history.analyses).toHaveLength(1);
    expect(history.analyses[0].id).toBe(result.analysisId);
    expect(history.analyses[0].counts.services).toBe(latest!.graph.services.length);

    // Registry `lastAnalyzed` got bumped.
    const fresh = getProjectBySlug(project.slug);
    expect(fresh?.lastAnalyzed).toBeTruthy();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Stash decision (issue #64) — the CLI must never silently stash a dirty
// working tree. Flags pre-approve; absent flag + dirty + non-interactive must
// exit with a clear message; absent flag + clean does nothing.
// ---------------------------------------------------------------------------

import { resolveStashDecision } from '../../tools/cli/src/commands/analyze';

describe('resolveStashDecision', () => {
  let workDir: string;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 't@t',
  };

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-stash-decision-'));
    execSync('git init -q -b main', { cwd: workDir, env });
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'committed\n');
    execSync('git add -A', { cwd: workDir, env });
    execSync('git -c commit.gpgsign=false commit -q -m init', { cwd: workDir, env });
  });

  afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  function makeDirty(): void {
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'dirty\n');
    fs.writeFileSync(path.join(workDir, 'untracked.txt'), 'new\n');
  }
  function cleanTree(): void {
    execSync('git checkout -- a.txt', { cwd: workDir, env });
    fs.rmSync(path.join(workDir, 'untracked.txt'), { force: true });
  }

  it('--no-stash: returns skipStash=true without prompting (dirty tree)', async () => {
    makeDirty();
    try {
      const result = await resolveStashDecision({ stash: false }, workDir);
      expect(result).toEqual({ skipStash: true });
    } finally {
      cleanTree();
    }
  });

  it('--stash: returns skipStash=false without prompting (dirty tree)', async () => {
    makeDirty();
    try {
      const result = await resolveStashDecision({ stash: true }, workDir);
      expect(result).toEqual({ skipStash: false });
    } finally {
      cleanTree();
    }
  });

  it('no flag + clean tree: returns skipStash=false without prompting', async () => {
    const result = await resolveStashDecision({}, workDir);
    expect(result).toEqual({ skipStash: false });
  });

  it('no flag + non-interactive + dirty tree: exits with helpful message', async () => {
    makeDirty();
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    try {
      await expect(resolveStashDecision({}, workDir)).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
      cleanTree();
    }
  });

  it('non-git directory: returns skipStash=false (nothing to stash)', async () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-stash-nongit-'));
    try {
      const result = await resolveStashDecision({}, nonGitDir);
      expect(result).toEqual({ skipStash: false });
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Gated live-LLM end-to-end. Set `LLM_TESTS=1 pnpm test` to run.
//
// Validates invariant prompts (discovery + enforcement) end-to-end on real
// Claude:
//   • Negative fixture — every `// INVARIANT-DRIFT:` marker has a matching
//     real invariant violation.
//   • Positive fixture — zero invariant violations on spec-compliant code.
//
// Rule-LLM testing is intentionally NOT exercised here. The negative fixture
// triggers rule-LLM scans across many files × many rules; bundling it into
// the same block easily blows past test timeouts and hides which prompt
// changed. The design (env gate + same fixture-copy infra + marker parser)
// supports rule-LLM blocks, so a `rule-llm.live.test.ts` can be added later
// using the same shape.
//
// LLM rules are explicitly disabled in this run via
// `enableLlmRulesOverride: false`. Invariants still get LLM access because
// `analyze-core` provisions an LLM provider whenever active invariants need
// it, independent of the rule-LLM toggle.
// ---------------------------------------------------------------------------

(LLM_TESTS ? describe : describe.skip)('CLI analyze e2e — live LLM (invariants)', () => {
  describe('negative fixture — every INVARIANT-DRIFT marker fires', () => {
    let workDir: string;
    let project: RegistryEntry;

    beforeAll(async () => {
      workDir = setupFixtureWorkdir(FIXTURE_SRC);
      project = registerProject(workDir);
      // Rule LLM off (slow + tested elsewhere). Invariants will still use LLM
      // because analyze-core provisions a provider whenever active invariants
      // need one — independent of `enableLlmRules`.
      updateProjectConfig(workDir, { enableLlmRules: false });
      clearLatestCache();
    }, 30_000);

    afterAll(() => {
      if (project) unregisterProject(project.slug);
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
      clearLatestCache();
    });

    it('catches every // INVARIANT-DRIFT: marker on real Claude', async () => {
      const llm = createLLMProvider();
      llm.setRepoPath(workDir);

      const suggestion = await suggestInvariants({
        repoPath: workDir,
        mode: 'full',
        llm,
      });
      for (const draft of suggestion.drafts) {
        acceptDraft(workDir, draft.id);
      }

      await analyzeInProcess(project, { enableLlmRulesOverride: false });

      const violations = readLatest(workDir)!.violations;

      // Every // INVARIANT-DRIFT: marker must match a violation whose
      // underlying invariant has the same `obligationKey` AND whose line
      // range covers the marker's line (± a small slop window — the LLM
      // sometimes pins to the function declaration when the drift is
      // "missing required code"). Same shape as the rule-marker test:
      // exact-string identity + line proximity, not file-only proximity.
      const invariantMarkers = parseInvariantDriftMarkers(workDir);
      const invariantViolations = violations.filter((v) => v.type === 'invariant');

      // Build invariantId → obligationKey map from the persisted active set.
      const activeInvariants = readAllActiveInvariants(workDir);
      const idToKey = new Map<string, string>();
      for (const inv of activeInvariants) {
        const decl = inv.declaration as { obligationKey?: string };
        if (decl.obligationKey) idToKey.set(inv.id, decl.obligationKey);
      }

      // Snapshot violations encode invariantId in `ruleKey` as
      // `invariants/<enforcement>/<id>`. Extract the id and look up the
      // obligationKey from the persisted active invariant.
      const extractInvariantId = (ruleKey: string | undefined): string | undefined => {
        if (!ruleKey) return undefined;
        const m = /^invariants\/[^/]+\/(.+)$/.exec(ruleKey);
        return m ? m[1] : undefined;
      };

      const SLOP = 5;
      const missingDrifts: ExpectedInvariantDrift[] = [];
      for (const m of invariantMarkers) {
        const matched = invariantViolations.some((v) => {
          if (!v.filePath) return false;
          const vAbs = path.resolve(workDir, v.filePath);
          if (vAbs !== m.filePath) return false;
          const id = extractInvariantId(v.ruleKey);
          const vKey = id ? idToKey.get(id) : undefined;
          if (vKey !== m.obligationKey) return false;
          const ls = v.lineStart ?? 0;
          const le = v.lineEnd ?? ls;
          return m.line >= ls - SLOP && m.line <= le + SLOP;
        });
        if (!matched) missingDrifts.push(m);
      }

      const driftReport = missingDrifts
        .map(
          (m) =>
            `  ${path.relative(workDir, m.filePath)}:${m.line} — ${m.obligationKey}`,
        )
        .join('\n');
      expect(missingDrifts, `missing invariant violations:\n${driftReport}`).toEqual(
        [],
      );
    }, 20 * 60 * 1000);
  });

  describe('positive fixture — zero invariant false positives', () => {
    let workDir: string;
    let project: RegistryEntry;

    beforeAll(async () => {
      workDir = setupFixtureWorkdir(FIXTURE_POSITIVE);
      project = registerProject(workDir);
      updateProjectConfig(workDir, { enableLlmRules: false });
      clearLatestCache();
    }, 30_000);

    afterAll(() => {
      if (project) unregisterProject(project.slug);
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
      clearLatestCache();
    });

    it('produces zero invariant violations on spec-compliant code', async () => {
      const llm = createLLMProvider();
      llm.setRepoPath(workDir);

      const suggestion = await suggestInvariants({
        repoPath: workDir,
        mode: 'full',
        llm,
      });
      for (const draft of suggestion.drafts) {
        acceptDraft(workDir, draft.id);
      }

      await analyzeInProcess(project, { enableLlmRulesOverride: false });

      const violations = readLatest(workDir)!.violations;
      const invariantViolations = violations.filter((v) => v.type === 'invariant');
      const invariantReport = invariantViolations
        .map(
          (v) =>
            `  ${v.filePath ? path.relative(workDir, v.filePath) : '?'}:${v.lineStart ?? '?'} — ${v.title}`,
        )
        .join('\n');
      expect(
        invariantViolations,
        `false-positive invariants:\n${invariantReport}`,
      ).toEqual([]);
    }, 20 * 60 * 1000);
  });
});

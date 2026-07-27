/**
 * Guard onboarding pipeline: materialize the Pg-stored curated corpus into a
 * checkout, run the (injectable) guard generate, and persist the scenario corpus
 * + generate report to the Pg guard store under the repo@commit ref. The heavy
 * steps (clone, generate) are injectable defaults, so these tests exercise the
 * REAL pipeline body over PGlite-backed spec/guard stores with fakes only at the
 * network/LLM seams.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgSpecStore, PgGuardStore } from '../../ee/packages/data-store/src/index';
import { setSpecStore, resetSpecStore, saveSpec } from '@truecourse/core/lib/spec-store';
import {
  setGuardStore,
  resetGuardStore,
  listScenarioFiles,
  readGuardResult,
  readGuardEvidenceAt,
  readManifest,
  readRecipeRaw,
  writeGuardDecisions,
  type RepoRef,
} from '@truecourse/core/lib/guard-store';
import { setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';
import {
  buildGuardReport,
  guardGenerateInProcess,
  OpenConflictsError,
} from '@truecourse/core/commands/guard-in-process';
import { writeGuardResult as writeCloneGuardResult } from '@truecourse/guard-runner';
import {
  generateGuards,
  type GuardGenerateResult,
  type ExtractRunner,
  type GenerateRunner,
} from '@truecourse/guard-generator';
import { flowStageRunners, stampMilestones } from '../guard-generator/helpers.js';
import type { GithubAuth } from '../../ee/packages/github-app/src/github';
import {
  materializeStoredCorpus,
  materializeAndGenerateGuard,
  createGuardOnboardingPipeline,
  boundedCloneSignal,
  GUARD_CLONE_TIMEOUT_MS,
  type GuardOnboardingRequest,
} from '../../ee/packages/github-app/src/guard-onboarding';

const REPO = 'acme/api';
const SHA = 'abc1234567';
const ref: RepoRef = { repoKey: REPO, commitSha: SHA };

const CORPUS = {
  version: 3,
  generatedAt: '2026-07-09T00:00:00.000Z',
  docs: [{ ref: 'README.md', areaTags: ['cli'] }],
  areas: [],
  relations: [],
  skippedDocs: [],
};

const request: GuardOnboardingRequest = {
  repoFullName: REPO,
  installationId: 42,
  defaultBranch: 'main',
  commitSha: SHA,
};

// The deps are only handed to the clone step, which every test fakes.
const deps = { auth: {} as GithubAuth };

/** A real (never-invoked) transport so `isLlmConfigured()` reads true. */
const fakeTransport: LlmTransport = async () => {
  throw new Error('the fake transport must never be invoked');
};

function writeFile(root: string, rel: string, body: string): void {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}

/** A complete `status: ok` generator result with one written scenario. */
function makeGuardResult(over: Partial<GuardGenerateResult> = {}): GuardGenerateResult {
  return {
    status: 'ok',
    sectionsTotal: 3,
    sectionsChanged: 1,
    skippedUnchanged: 2,
    noChanges: false,
    written: [
      { id: 's1', title: 'shows help', doc: 'README.md', anchor: 'intro', file: '.truecourse/scenarios/cli/s1.yaml' },
    ],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    birthPassed: 1,
    heldSections: [],
    orphanedDismissals: [],
    ...over,
  };
}

/** Simulate what a real generate leaves in the clone: the scenario corpus tree
 *  plus the file-based `guard/result.json` report. */
function fakeGenerateWriting(result: GuardGenerateResult) {
  return vi.fn(async (dir: string) => {
    writeFile(dir, '.truecourse/scenarios/recipe.json', JSON.stringify({ guard: 1, entry: ['node', 'cli.js'] }));
    writeFile(dir, '.truecourse/scenarios/manifest.json', JSON.stringify({ version: 2, flows: [] }));
    writeFile(dir, '.truecourse/scenarios/cli/s1.yaml', 'guard: 2\nid: s1\n');
    writeCloneGuardResult(
      dir,
      buildGuardReport(result, '2026-07-09T12:00:00.000Z', {
        calls: 4,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.12,
      }),
    );
    return { guard: result };
  });
}

let client: PGlite;

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as EeDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setSpecStore(new PgSpecStore(db));
  setGuardStore(new PgGuardStore(db));
  setDefaultTransport(fakeTransport);
});

afterEach(async () => {
  setDefaultTransport(undefined);
  resetSpecStore();
  resetGuardStore();
  await client.close();
});

describe('materializeStoredCorpus', () => {
  it('writes the stored corpus into <checkout>/.truecourse/specs/corpus.json and returns true', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-onb-'));
    try {
      expect(await materializeStoredCorpus(ref, checkout)).toBe(true);
      const file = path.join(checkout, '.truecourse', 'specs', 'corpus.json');
      expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual(CORPUS);
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });

  it('returns false (and writes nothing) when no corpus is stored for the ref', async () => {
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-onb-'));
    try {
      expect(await materializeStoredCorpus(ref, checkout)).toBe(false);
      expect(fs.existsSync(path.join(checkout, '.truecourse', 'specs', 'corpus.json'))).toBe(false);
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });
});

describe('guard onboarding pipeline', () => {
  it('no stored corpus (and none committed) → clean noCorpus no-op: generate never runs, nothing persists', async () => {
    let cloneDir = '';
    const cloneRepo = vi.fn(async (_deps: unknown, _req: unknown, dir: string) => {
      cloneDir = dir; // an "empty repo" — no committed .truecourse/specs/corpus.json
    });
    const generate = vi.fn();
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    const result = await pipeline.run(deps, request);

    expect(result).toEqual({ savedFileCount: 0, scenariosWritten: 0, noCorpus: true, openConflicts: 0 });
    expect(generate).not.toHaveBeenCalled();
    expect(await readGuardResult(REPO)).toBeNull();
    // The temp clone is removed even on the no-op path.
    expect(cloneDir).not.toBe('');
    expect(fs.existsSync(cloneDir)).toBe(false);
  });

  it('materializes the corpus, generates, and persists scenarios + report under the ref', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    let sawCorpusInClone = false;
    let cloneDir = '';
    const cloneRepo = vi.fn(async (_deps: unknown, _req: unknown, dir: string) => {
      cloneDir = dir;
    });
    const inner = fakeGenerateWriting(makeGuardResult());
    const generate = vi.fn(async (dir: string, tracker?: unknown) => {
      // The corpus must be in place BEFORE generation (it is the doc universe).
      sawCorpusInClone = fs.existsSync(path.join(dir, '.truecourse', 'specs', 'corpus.json'));
      return inner(dir, tracker as never);
    });
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    const result = await pipeline.run(deps, request);

    expect(sawCorpusInClone).toBe(true);
    // recipe.json + manifest.json + cli/s1.yaml persisted; 1 scenario written.
    expect(result).toEqual({ savedFileCount: 3, scenariosWritten: 1, noCorpus: false, openConflicts: 0 });

    // The scenario corpus is readable back through the store seam at the ref
    // (listScenarioFiles lists the YAMLs; recipe/manifest have their own readers).
    expect(await listScenarioFiles(REPO, SHA)).toEqual(['.truecourse/scenarios/cli/s1.yaml']);
    expect(await readManifest(REPO, SHA)).not.toBeNull();
    expect(await readRecipeRaw(REPO, SHA)).toContain('"entry"');

    // The persisted report is the CLONE's file report (usage totals included).
    const report = await readGuardResult(REPO, SHA);
    expect(report).not.toBeNull();
    expect(report!.status).toBe('ok');
    expect(report!.usage).toEqual({ calls: 4, inputTokens: 100, outputTokens: 50, costUsd: 0.12 });

    // Clone cleaned up.
    expect(fs.existsSync(cloneDir)).toBe(false);
  });

  it('copies birth-finding evidence out of the checkout so it resolves after cleanup', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    const RUN_ID = 'gen1234_abcd';
    const evidencePath = `.truecourse/guard/evidence/${RUN_ID}/s7`;
    const finding = {
      doc: 'README.md',
      anchor: 'intro',
      kind: 'birth' as const,
      title: 'does a thing',
      step: 2,
      expected: 'exit 0',
      actual: 'exit 1',
      evidencePath,
    };
    let cloneDir = '';
    const cloneRepo = vi.fn(async (_deps: unknown, _req: unknown, dir: string) => {
      cloneDir = dir;
    });
    const generate = vi.fn(async (dir: string) => {
      writeFile(dir, '.truecourse/scenarios/recipe.json', JSON.stringify({ guard: 1, entry: ['node', 'cli.js'] }));
      writeFile(dir, '.truecourse/scenarios/manifest.json', JSON.stringify({ version: 2, flows: [] }));
      writeFile(dir, '.truecourse/scenarios/cli/s1.yaml', 'guard: 2\nid: s1\n');
      // The birth run wrote its transcript into the checkout (removed after run).
      writeFile(dir, `${evidencePath}/transcript.txt`, 'birth transcript');
      writeFile(dir, `${evidencePath}/diff.txt`, 'expected exit 0, got 1');
      const result = makeGuardResult({ birthFindings: [finding] });
      writeCloneGuardResult(dir, buildGuardReport(result, '2026-07-09T12:00:00.000Z'));
      return { guard: result };
    });
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    const result = await pipeline.run(deps, request);
    expect(result.noCorpus).toBe(false);

    // The report persisted with the finding + its evidence pointer.
    const report = await readGuardResult(REPO, SHA);
    expect(report!.birthFindings[0]!.evidencePath).toBe(evidencePath);

    // The checkout is gone, but the birth evidence resolves through the store.
    expect(fs.existsSync(cloneDir)).toBe(false);
    expect(await readGuardEvidenceAt(REPO, evidencePath, 'transcript.txt')).toBe('birth transcript');
    expect(await readGuardEvidenceAt(REPO, evidencePath, 'diff.txt')).toBe('expected exit 0, got 1');
  });

  // ------------------------------------------------------------------
  // Guard decisions (dismissedClaims) — the dashboard writes them to the Pg
  // guard store, but the generator reads the CHECKOUT's
  // `scenarios/decisions.json` (file-based, by design: it is committable).
  // The pipeline must materialize the stored decisions into the clone, else a
  // hosted regenerate re-authors every dismissed claim and its section stays
  // held forever.
  // ------------------------------------------------------------------

  const GUARD_DECISIONS = {
    version: 1 as const,
    dismissedFlows: [],
    dismissedClaims: [
      {
        doc: 'README.md',
        anchor: 'intro',
        title: 'shows help on --help',
        dismissedAt: '2026-07-14T17:40:19.614Z',
      },
    ],
  };

  it('materializes the Pg-stored guard decisions into the checkout before generate runs', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    await writeGuardDecisions(REPO, GUARD_DECISIONS);

    let decisionsSeenByGenerate: unknown = null;
    const cloneRepo = vi.fn(async () => {});
    const inner = fakeGenerateWriting(makeGuardResult());
    const generate = vi.fn(async (dir: string, tracker?: unknown) => {
      const file = path.join(dir, '.truecourse', 'scenarios', 'decisions.json');
      if (fs.existsSync(file)) decisionsSeenByGenerate = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return inner(dir, tracker as never);
    });
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    await pipeline.run(deps, request);

    expect(decisionsSeenByGenerate).toEqual(GUARD_DECISIONS);
  });

  it('preserves a committed decisions.json in the clone when none are stored', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    const committed = {
      version: 1,
      dismissedClaims: [
        { doc: 'README.md', anchor: 'intro', title: 'committed dismissal', dismissedAt: '2026-07-01T00:00:00Z' },
      ],
    };
    const cloneRepo = vi.fn(async (_deps: unknown, _req: unknown, dir: string) => {
      // The decisions file is committable — this repo carries one in git.
      writeFile(dir, '.truecourse/scenarios/decisions.json', JSON.stringify(committed));
    });
    let decisionsSeenByGenerate: unknown = null;
    const inner = fakeGenerateWriting(makeGuardResult());
    const generate = vi.fn(async (dir: string, tracker?: unknown) => {
      const file = path.join(dir, '.truecourse', 'scenarios', 'decisions.json');
      decisionsSeenByGenerate = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return inner(dir, tracker as never);
    });
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    await pipeline.run(deps, request);

    expect(decisionsSeenByGenerate).toEqual(committed);
  });

  it('materializes guard decisions on the skipMaterialize path too (head-regen keeps dismissals)', async () => {
    await writeGuardDecisions(REPO, GUARD_DECISIONS);
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-onb-'));
    try {
      // skipMaterialize callers curated the checkout's own corpus already.
      writeFile(checkout, '.truecourse/specs/corpus.json', JSON.stringify(CORPUS));
      let decisionsSeenByGenerate: unknown = null;
      const inner = fakeGenerateWriting(makeGuardResult());
      const generate = vi.fn(async (dir: string, tracker?: unknown) => {
        const file = path.join(dir, '.truecourse', 'scenarios', 'decisions.json');
        if (fs.existsSync(file)) decisionsSeenByGenerate = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return inner(dir, tracker as never);
      });

      const generated = await materializeAndGenerateGuard(ref, checkout, generate as never, {
        skipMaterialize: true,
      });

      expect(generated).not.toBeNull();
      expect(decisionsSeenByGenerate).toEqual(GUARD_DECISIONS);
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });

  // A PR-head regen must honor the PR's dismissals overlay (`_pr/<n>`) too — the
  // generate-side analog of the gate's foldDismissals. Without the merge, a
  // PR-scoped dismissal never suppresses its claim in the regenerated corpus and
  // the held section stays held forever.
  const PR_OVERLAY = {
    version: 1 as const,
    dismissedFlows: [],
    dismissedClaims: [
      {
        doc: 'README.md',
        anchor: 'errors',
        title: 'pr-dismissed claim',
        dismissedAt: '2026-07-15T16:51:08.968Z',
      },
    ],
  };

  it('merges the PR dismissals overlay over the repo row when `pr` is set (PR-head regen)', async () => {
    await writeGuardDecisions(REPO, GUARD_DECISIONS);
    await writeGuardDecisions(REPO, PR_OVERLAY, '_pr/25');
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-onb-'));
    try {
      writeFile(checkout, '.truecourse/specs/corpus.json', JSON.stringify(CORPUS));
      let decisionsSeenByGenerate: unknown = null;
      const inner = fakeGenerateWriting(makeGuardResult());
      const generate = vi.fn(async (dir: string, tracker?: unknown) => {
        const file = path.join(dir, '.truecourse', 'scenarios', 'decisions.json');
        if (fs.existsSync(file)) decisionsSeenByGenerate = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return inner(dir, tracker as never);
      });

      const generated = await materializeAndGenerateGuard(ref, checkout, generate as never, {
        skipMaterialize: true,
        pr: 25,
      });

      expect(generated).not.toBeNull();
      expect(decisionsSeenByGenerate).toEqual({
        version: 1,
        dismissedClaims: [...GUARD_DECISIONS.dismissedClaims, ...PR_OVERLAY.dismissedClaims],
        dismissedFlows: [],
      });
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });

  it('a PR overlay alone (no repo dismissals) still materializes when `pr` is set', async () => {
    await writeGuardDecisions(REPO, PR_OVERLAY, '_pr/25');
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-onb-'));
    try {
      writeFile(checkout, '.truecourse/specs/corpus.json', JSON.stringify(CORPUS));
      let decisionsSeenByGenerate: unknown = null;
      const inner = fakeGenerateWriting(makeGuardResult());
      const generate = vi.fn(async (dir: string, tracker?: unknown) => {
        const file = path.join(dir, '.truecourse', 'scenarios', 'decisions.json');
        if (fs.existsSync(file)) decisionsSeenByGenerate = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return inner(dir, tracker as never);
      });

      await materializeAndGenerateGuard(ref, checkout, generate as never, {
        skipMaterialize: true,
        pr: 25,
      });

      expect(decisionsSeenByGenerate).toEqual({ version: 1, dismissedClaims: PR_OVERLAY.dismissedClaims, dismissedFlows: [] });
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });

  it('ignores PR overlays when `pr` is unset (repo-scope generate)', async () => {
    await writeGuardDecisions(REPO, GUARD_DECISIONS);
    await writeGuardDecisions(REPO, PR_OVERLAY, '_pr/25');
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-onb-'));
    try {
      writeFile(checkout, '.truecourse/specs/corpus.json', JSON.stringify(CORPUS));
      let decisionsSeenByGenerate: unknown = null;
      const inner = fakeGenerateWriting(makeGuardResult());
      const generate = vi.fn(async (dir: string, tracker?: unknown) => {
        const file = path.join(dir, '.truecourse', 'scenarios', 'decisions.json');
        if (fs.existsSync(file)) decisionsSeenByGenerate = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return inner(dir, tracker as never);
      });

      await materializeAndGenerateGuard(ref, checkout, generate as never, { skipMaterialize: true });

      expect(decisionsSeenByGenerate).toEqual(GUARD_DECISIONS);
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });

  it('a committed corpus in the clone suffices when none is stored (no false noCorpus)', async () => {
    const cloneRepo = vi.fn(async (_deps: unknown, _req: unknown, dir: string) => {
      // The repo commits its corpus (it is committable) — the clone carries it.
      writeFile(dir, '.truecourse/specs/corpus.json', JSON.stringify(CORPUS));
    });
    const generate = fakeGenerateWriting(makeGuardResult());
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    const result = await pipeline.run(deps, request);
    expect(result.noCorpus).toBe(false);
    expect(generate).toHaveBeenCalled();
  });

  it('recipe-failed → throws the reason and persists nothing', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    const cloneRepo = vi.fn(async () => {});
    const generate = vi.fn(async () => ({
      guard: makeGuardResult({ status: 'recipe-failed', reason: 'recipe discovery failed', written: [] }),
    }));
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    await expect(pipeline.run(deps, request)).rejects.toThrow('recipe discovery failed');
    expect(await readGuardResult(REPO)).toBeNull();
    expect(await listScenarioFiles(REPO)).toEqual([]);
  });

  it('fails loudly before generating when no LLM provider is configured', async () => {
    setDefaultTransport(undefined);
    await saveSpec(ref, 'corpus', CORPUS);
    const cloneRepo = vi.fn(async () => {});
    const generate = vi.fn();
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    await expect(pipeline.run(deps, request)).rejects.toThrow(/No LLM provider is configured/);
    expect(generate).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Recipe install through the hosted path — the REAL generate over a fresh
  // checkout (no node_modules), proving the OSS install step needs no EE change.
  // ------------------------------------------------------------------

  const FIXTURE_BIN = fileURLToPath(new URL('../fixtures/guard-fixture-cli/bin.mjs', import.meta.url));
  const DOC_BODY = '## version\n`--version` prints the version and exits 0.\n';

  const extractVersion: ExtractRunner = async ({ outline }) => ({
    claims: [
      {
        claim: '`--version` prints the version and exits 0',
        driver: 'cli',
        sectionAnchor: outline[0].anchor,
        reason: 'exit code observable',
      },
    ],
    untestable: [],
  });
  const authorVersion: GenerateRunner = async (ctx) => ({
    scenario: stampMilestones(
      { title: 'version works', driver: 'cli' as const, steps: [{ run: ['--version'], expect: { exit: 0 } }] },
      ctx.milestones.length,
    ),
  });

  /** The real generate wired with a fixed recipe proposal — no LLM, everything else real. */
  function realGenerateProposing(proposal: { install?: string; build: string; entry: string[] }) {
    return async (dir: string) => ({
      guard: await generateGuards({
        repoRoot: dir,
        ...flowStageRunners(dir),
        recipeRunner: async () => proposal,
        extractRunner: extractVersion,
        generateRunner: authorVersion,
      }),
    });
  }

  it('a checkout without node_modules whose proposal declares install generates OK (install before build)', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    const cloneRepo = vi.fn(async (_deps: unknown, _req: unknown, dir: string) => {
      // A "fresh clone": the doc tree only — nothing installed, nothing built.
      writeFile(dir, 'README.md', DOC_BODY);
    });
    // The verification/birth build only succeeds when the install already ran.
    const generate = realGenerateProposing({
      install: 'touch install-marker',
      build: 'test -f install-marker',
      entry: ['node', FIXTURE_BIN],
    });
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    const result = await pipeline.run(deps, request);

    expect(result.noCorpus).toBe(false);
    expect(result.scenariosWritten).toBe(1);
    // The discovered recipe persisted to the hosted store WITH its install step.
    expect(await readRecipeRaw(REPO, SHA)).toContain('"install": "touch install-marker"');
  });

  it('a failing proposal install fails the pipeline with the install reason (the worker notification detail)', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    const cloneRepo = vi.fn(async (_deps: unknown, _req: unknown, dir: string) => {
      writeFile(dir, 'README.md', DOC_BODY);
    });
    const generate = realGenerateProposing({ install: 'false', build: 'true', entry: ['node', FIXTURE_BIN] });
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    await expect(pipeline.run(deps, request)).rejects.toThrow(/install `false` failed/);
    expect(await readGuardResult(REPO)).toBeNull();
    expect(await listScenarioFiles(REPO)).toEqual([]);
  });

  // ------------------------------------------------------------------
  // Open-conflict gate, EE parity. OSS `guard generate` hard-fails on an
  // unresolved within-area overlap (see tests/core/guard-generate-conflict-gate)
  // because extracting both sides births a red finding that is really the
  // dispute. Birth generation runs the SAME `guardGenerateInProcess`, so the
  // same corpus must hit the same gate — the gate reads the corpus + decisions
  // the pipeline MATERIALIZES into the checkout, so both fire on the ephemeral
  // clone the store keys nothing under.
  // ------------------------------------------------------------------

  const CONFLICT_NOTE = 'auth0_id vs auth0_sub for the user identity';
  const conflictedCorpus = {
    version: 3,
    generatedAt: '2026-07-09T00:00:00.000Z',
    docs: [
      { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/users-entity'] },
      { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/users-entity'] },
    ],
    areas: [
      {
        id: 'booking/users-entity',
        product: 'booking',
        concern: 'users-entity',
        docRefs: ['docs/v1.md', 'docs/v2.md'],
        overlaps: [{ docs: ['docs/v1.md', 'docs/v2.md'], note: CONFLICT_NOTE, sections: [] }],
      },
    ],
    relations: [],
    skippedDocs: [],
  };
  const cloneConflictDocs = vi.fn(async (_deps: unknown, _req: unknown, dir: string) => {
    writeFile(dir, 'docs/v1.md', '# Users v1\nThe user identity is auth0_id.');
    writeFile(dir, 'docs/v2.md', '# Users v2\nThe user identity is auth0_sub.');
  });
  /** The production generate seam (the real in-process driver) with a sentinel at
   *  every LLM stage — reaching one proves the gate let generation through. */
  function guardGenerateWithSentinel(sentinel: () => Promise<never>): (dir: string) => Promise<unknown> {
    return (dir: string) =>
      guardGenerateInProcess(dir, {
        recipeRunner: sentinel as never,
        extractRunner: sentinel as never,
        generateRunner: sentinel as never,
        fidelityRunner: sentinel as never,
      });
  }

  it('a stored corpus with an unresolved overlap hits the conflict gate: a blocked report persists, no scenario set', async () => {
    await saveSpec(ref, 'corpus', conflictedCorpus);
    const llmStage = vi.fn(async (): Promise<never> => {
      throw new Error('the conflict gate must fire before any LLM stage');
    });
    const pipeline = createGuardOnboardingPipeline({
      cloneRepo: cloneConflictDocs,
      generate: guardGenerateWithSentinel(llmStage),
    });

    // The run RESOLVES — a needs-attention outcome, not a failure — reporting the
    // open-conflict count and skipping the scenario write.
    const result = await pipeline.run(deps, request);
    expect(result).toEqual({ savedFileCount: 0, scenariosWritten: 0, noCorpus: false, openConflicts: 1 });
    expect(llmStage).not.toHaveBeenCalled();

    // A blocked `open-conflicts` report persisted, naming both disputing docs; NO
    // scenario set, so the chain never fires a baseline run over an empty corpus.
    const report = await readGuardResult(REPO, SHA);
    expect(report).not.toBeNull();
    expect(report!.status).toBe('open-conflicts');
    expect(report!.reason).toContain('docs/v1.md');
    expect(report!.reason).toContain('docs/v2.md');
    expect(report!.reason).toContain(CONFLICT_NOTE);
    expect(await listScenarioFiles(REPO)).toEqual([]);
  });

  it('a stored resolving verdict is materialized into the checkout and lets generation past the gate', async () => {
    await saveSpec(ref, 'corpus', conflictedCorpus);
    // A section-scoped verdict on the sectionless overlap (null anchors match its
    // identity) resolves the dispute — the gate must let generation proceed.
    await saveSpec(ref, 'decisions', {
      version: 1,
      manualIncludes: [],
      manualExcludes: [],
      relations: [],
      manualAreas: [],
      conflictResolutions: [
        {
          docA: 'docs/v1.md',
          anchorA: null,
          docB: 'docs/v2.md',
          anchorB: null,
          verdict: 'b',
          resolvedAt: '2026-07-10T00:00:00Z',
        },
      ],
    });
    // Sentinel at the first LLM stage (recipe discovery): reaching it proves the
    // gate let generation through. It throws, so the run rejects — but NOT with an
    // OpenConflictsError, and the sentinel was invoked.
    const llmStage = vi.fn(async (): Promise<never> => {
      throw new Error('gate passed — reached an LLM stage');
    });
    const pipeline = createGuardOnboardingPipeline({
      cloneRepo: cloneConflictDocs,
      generate: guardGenerateWithSentinel(llmStage),
    });

    const err = await pipeline.run(deps, request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(OpenConflictsError);
    expect(llmStage).toHaveBeenCalled();

    // The generate threw past the gate, so no report / scenarios were persisted.
    expect(await readGuardResult(REPO)).toBeNull();
    expect(await listScenarioFiles(REPO)).toEqual([]);
  });

  it('cleans up the clone when generation throws', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    let cloneDir = '';
    const cloneRepo = vi.fn(async (_deps: unknown, _req: unknown, dir: string) => {
      cloneDir = dir;
    });
    const generate = vi.fn(async () => {
      throw new Error('LLM upstream 500');
    });
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    await expect(pipeline.run(deps, request)).rejects.toThrow('LLM upstream 500');
    expect(fs.existsSync(cloneDir)).toBe(false);
  });
});

describe('guard onboarding pipeline — clone-phase bound', () => {
  /** A clone that hangs until the signal the pipeline hands it aborts — the
   *  wedged-remote shape. Bails with a distinct error if never aborted, so a
   *  missing bound fails fast instead of hitting the suite timeout. */
  function hangingClone() {
    let cloneDir = '';
    const cloneRepo = vi.fn(
      (cloneDeps: { auth: GithubAuth; signal?: AbortSignal }, _req: unknown, dir: string) =>
        new Promise<void>((_resolve, reject) => {
          cloneDir = dir;
          const bail = setTimeout(() => reject(new Error('clone was never aborted')), 1_000);
          cloneDeps.signal?.addEventListener('abort', () => {
            clearTimeout(bail);
            reject(cloneDeps.signal!.reason);
          });
        }),
    );
    return { cloneRepo, dirOf: () => cloneDir };
  }

  it('honors an external abort signal: the run fails and the checkout is removed', async () => {
    const { cloneRepo, dirOf } = hangingClone();
    const generate = vi.fn();
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate });

    const controller = new AbortController();
    const run = pipeline.run(deps, request, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate).not.toHaveBeenCalled();
    expect(fs.existsSync(dirOf())).toBe(false);
  });

  it('bounds the clone by the wall-clock even with NO external signal', async () => {
    const { cloneRepo, dirOf } = hangingClone();
    const generate = vi.fn();
    const pipeline = createGuardOnboardingPipeline({ cloneRepo, generate, cloneTimeoutMs: 25 });

    await expect(pipeline.run(deps, request)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(generate).not.toHaveBeenCalled();
    expect(fs.existsSync(dirOf())).toBe(false);
  });

  it('the default wall-clock mirrors the gate clone bound (5 minutes)', () => {
    expect(GUARD_CLONE_TIMEOUT_MS).toBe(5 * 60_000);
  });

  it('boundedCloneSignal folds an external abort in before the timeout fires', () => {
    const controller = new AbortController();
    const signal = boundedCloneSignal(controller.signal, 60_000);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});

/**
 * Workspace guard generation over the workspace corpus (the Scenarios tab's core).
 * `generateWorkspaceGuardInProcess` materializes the persisted workspace corpus +
 * the union doc bodies into a scratch tree, runs the shared in-process guard
 * generate, and persists the scenario set + report under WORKSPACE scope
 * (`repoKey = 'ws:<org>'`). These tests exercise the REAL wrapper over PGlite-backed
 * spec/guard stores with a fake only at the LLM/generate seam — so the scenario
 * corpus round-trips through the `ws:<org>`-keyed PgGuardStore and reads back
 * through `readWorkspaceGuardCoverage` exactly as the tab consumes it. The
 * open-conflict gate is exercised with the REAL in-process driver (sentinels at
 * every LLM stage) so the same gate the repo path hits fires on the workspace tree.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgSpecStore, PgGuardStore } from '../../ee/packages/data-store/src/index';
import { setSpecStore, resetSpecStore, saveWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import {
  setGuardStore,
  resetGuardStore,
  readGuardResult,
  listScenarioFiles,
} from '@truecourse/core/lib/guard-store';
import { setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';
import { writeGuardResult as writeCloneGuardResult } from '@truecourse/guard-runner';
import { buildGuardReport } from '@truecourse/core/commands/guard-in-process';
import {
  generateWorkspaceGuardInProcess,
  guardGenerateInProcess,
  estimateWorkspaceGuard,
  readWorkspaceGuardCoverage,
  workspaceGuardKey,
  WORKSPACE_GUARD_COMMIT,
} from '@truecourse/core/commands/guard-in-process';
import type { GuardGenerateResult } from '@truecourse/guard-generator';

const ORG = 'org_ws_guard';

/** A real (never-invoked) transport so `isLlmConfigured()` reads true. */
const fakeTransport: LlmTransport = async () => {
  throw new Error('the fake transport must never be invoked');
};

/** A one-doc, no-conflict corpus (one kept doc + one area). */
const CORPUS = {
  version: 3 as const,
  generatedAt: '2026-07-14T00:00:00.000Z',
  docs: [{ ref: 'knowledge/confluence/1.md', kind: 'spec', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/checkout'] }],
  areas: [{ id: 'core/checkout', product: 'core', concern: 'checkout', docRefs: ['knowledge/confluence/1.md'], overlaps: [] }],
  relations: [],
  skippedDocs: [],
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
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    noChanges: false,
    written: [{ id: 's1', title: 'checkout totals in cents', doc: 'knowledge/confluence/1.md', anchor: 'intro', file: '.truecourse/scenarios/core/s1.yaml' }],
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

/** A valid committed scenario YAML (loadScenarios parses + validates it). */
const SCENARIO_YAML = [
  'guard: 1',
  'id: s1',
  'title: checkout totals in cents',
  'binds:',
  '  doc: knowledge/confluence/1.md',
  '  section: intro',
  '  fingerprint: sha256:abc',
  'driver: cli',
  'steps:',
  '  - run: ["--help"]',
  '    expect:',
  '      exit: 0',
  '',
].join('\n');

/** Simulate what a real generate leaves in the scratch tree: the scenario corpus
 *  plus the file-based `guard/result.json` report. */
function fakeGenerateWriting(result: GuardGenerateResult) {
  return vi.fn(async (dir: string) => {
    writeFile(dir, '.truecourse/scenarios/recipe.json', JSON.stringify({ guard: 1, build: 'true', entry: ['node', 'cli.js'] }));
    writeFile(dir, '.truecourse/scenarios/manifest.json', JSON.stringify({ guard: 1, sections: [] }));
    writeFile(dir, '.truecourse/scenarios/core/s1.yaml', SCENARIO_YAML);
    writeCloneGuardResult(
      dir,
      buildGuardReport(result, '2026-07-14T12:00:00.000Z', { calls: 4, inputTokens: 100, outputTokens: 50, costUsd: 0.12 }),
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
  process.env.TRUECOURSE_NO_PRICE_FETCH = '1';
});

afterEach(async () => {
  setDefaultTransport(undefined);
  resetSpecStore();
  resetGuardStore();
  await client.close();
});

describe('generateWorkspaceGuardInProcess', () => {
  it('no processed corpus → clean noCorpus no-op: generate never runs, nothing persists', async () => {
    const generate = vi.fn();
    const result = await generateWorkspaceGuardInProcess({ workspaceOrgId: ORG, docs: [], generate });
    expect(result).toEqual({ savedFileCount: 0, scenariosWritten: 0, noCorpus: true, openConflicts: 0 });
    expect(generate).not.toHaveBeenCalled();
    expect(await readGuardResult(workspaceGuardKey(ORG))).toBeNull();
  });

  it('generates over the corpus + union docs and persists a readable scenario corpus under ws:<org>', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', CORPUS);
    let sawCorpusInTree = false;
    const generate = vi.fn(async (dir: string) => {
      // The corpus + doc bodies are materialized BEFORE generation.
      sawCorpusInTree =
        fs.existsSync(path.join(dir, '.truecourse', 'specs', 'corpus.json')) &&
        fs.existsSync(path.join(dir, 'knowledge', 'confluence', '1.md'));
      return fakeGenerateWriting(makeGuardResult())(dir);
    });

    const result = await generateWorkspaceGuardInProcess({
      workspaceOrgId: ORG,
      docs: [{ docPath: 'knowledge/confluence/1.md', markdown: '# Checkout\nTotals are in cents.' }],
      generate,
    });

    expect(sawCorpusInTree).toBe(true);
    expect(result).toEqual({ savedFileCount: 3, scenariosWritten: 1, noCorpus: false, openConflicts: 0 });

    // The scenario corpus round-trips through the ws:<org>-keyed store.
    expect(await listScenarioFiles(workspaceGuardKey(ORG), WORKSPACE_GUARD_COMMIT)).toEqual([
      '.truecourse/scenarios/core/s1.yaml',
    ]);
    const report = await readGuardResult(workspaceGuardKey(ORG), WORKSPACE_GUARD_COMMIT);
    expect(report?.status).toBe('ok');
    expect(report?.usage).toEqual({ calls: 4, inputTokens: 100, outputTokens: 50, costUsd: 0.12 });

    // …and reads back through the coverage payload the Scenarios tab consumes.
    const coverage = await readWorkspaceGuardCoverage(ORG);
    expect(coverage.hasGenerated).toBe(true);
    expect(coverage.hasScenarios).toBe(true);
    expect(coverage.report?.status).toBe('ok');
    expect(coverage.scenarios).toEqual([
      {
        id: 's1',
        title: 'checkout totals in cents',
        doc: 'knowledge/confluence/1.md',
        anchor: 'intro',
        file: '.truecourse/scenarios/core/s1.yaml',
        handWritten: true,
      },
    ]);
  });

  it('an unresolved within-area overlap trips the conflict gate: a blocked report persists, no scenario set', async () => {
    const conflicted = {
      version: 3 as const,
      generatedAt: '2026-07-14T00:00:00.000Z',
      docs: [
        { ref: 'knowledge/confluence/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/users'] },
        { ref: 'knowledge/jira/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/users'] },
      ],
      areas: [
        {
          id: 'booking/users',
          product: 'booking',
          concern: 'users',
          docRefs: ['knowledge/confluence/v1.md', 'knowledge/jira/v2.md'],
          overlaps: [{ docs: ['knowledge/confluence/v1.md', 'knowledge/jira/v2.md'], note: 'auth0_id vs auth0_sub', sections: [] }],
        },
      ],
      relations: [],
      skippedDocs: [],
    };
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', conflicted);
    // The production generate seam (the REAL driver) with a sentinel at every LLM
    // stage — reaching one proves the gate (wrongly) let generation through.
    const sentinel = vi.fn(async (): Promise<never> => {
      throw new Error('the conflict gate must fire before any LLM stage');
    });

    const result = await generateWorkspaceGuardInProcess({
      workspaceOrgId: ORG,
      docs: [
        { docPath: 'knowledge/confluence/v1.md', markdown: '# Users v1\nThe user identity is auth0_id.' },
        { docPath: 'knowledge/jira/v2.md', markdown: '# Users v2\nThe user identity is auth0_sub.' },
      ],
      generate: (dir) =>
        guardGenerateInProcess(dir, {
          recipeRunner: sentinel as never,
          extractRunner: sentinel as never,
          generateRunner: sentinel as never,
          fidelityRunner: sentinel as never,
        }),
    });

    expect(result).toEqual({ savedFileCount: 0, scenariosWritten: 0, noCorpus: false, openConflicts: 1 });
    expect(sentinel).not.toHaveBeenCalled();

    // A blocked `open-conflicts` report persisted (naming both disputing docs); NO
    // scenario set was saved.
    const report = await readGuardResult(workspaceGuardKey(ORG), WORKSPACE_GUARD_COMMIT);
    expect(report?.status).toBe('open-conflicts');
    expect(report?.reason).toContain('knowledge/confluence/v1.md');
    expect(report?.reason).toContain('knowledge/jira/v2.md');
    expect(await listScenarioFiles(workspaceGuardKey(ORG))).toEqual([]);
  });
});

describe('estimateWorkspaceGuard', () => {
  it('a no-corpus workspace yields a no-stage estimate', async () => {
    const est = await estimateWorkspaceGuard({ workspaceOrgId: ORG, docs: [] });
    expect(est.stages).toEqual([]);
    expect(est.totalEstimatedTokens).toBe(0);
  });

  it('prices the guard stages over the corpus + union docs (the modal estimate shape)', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', CORPUS);
    const est = await estimateWorkspaceGuard({
      workspaceOrgId: ORG,
      docs: [
        {
          docPath: 'knowledge/confluence/1.md',
          markdown: '# Checkout\n\n## Totals\nThe checkout total is computed in cents and returned as an integer.\n',
        },
      ],
    });
    // The same LlmEstimate shape the OSS modal renders: staged, with a subject.
    expect(Array.isArray(est.stages)).toBe(true);
    expect(est.stages!.length).toBeGreaterThan(0);
    expect(est.stages!.map((s) => s.stage)).toContain('guardExtract');
    expect(est.totalEstimatedTokens).toBeGreaterThan(0);
    expect(typeof est.subjectLabel).toBe('string');
  });
});

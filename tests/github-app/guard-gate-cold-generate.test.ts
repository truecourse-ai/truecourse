/**
 * defaultGuardColdGenerate: the gate's cold-path body — materialize the Pg-stored
 * curated corpus into the checkout, run the (injectable) guard generate, persist
 * the scenario corpus + report under the ref via the INJECTED guard store, and
 * return the freshly parsed corpus for the same-pass run. Exercised over
 * PGlite-backed spec + guard stores with the LLM generate faked (it writes the
 * scenario tree into the clone, exactly as the real in-process generate does).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgSpecStore, PgGuardStore } from '../../ee/packages/data-store/src/index';
import { setSpecStore, resetSpecStore, saveSpec } from '@truecourse/core/lib/spec-store';
import { setGuardStore, resetGuardStore, type RepoRef } from '@truecourse/core/lib/guard-store';
import { setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';
import { buildGuardReport } from '@truecourse/core/commands/guard-in-process';
import { writeGuardResult as writeCloneGuardResult } from '@truecourse/guard-runner';
import {
  generateGuards,
  type GuardGenerateResult,
  type ExtractRunner,
  type GenerateRunner,
} from '@truecourse/guard-generator';
import { defaultGuardColdGenerate } from '../../ee/packages/github-app/src/guard-gate-runner';

const REPO = 'acme/api';
const SHA = 'base1234567';
const ref: RepoRef = { repoKey: REPO, commitSha: SHA };

const CORPUS = {
  version: 3,
  generatedAt: '2026-07-09T00:00:00.000Z',
  docs: [{ ref: 'README.md', areaTags: ['cli'] }],
  areas: [],
  relations: [],
  skippedDocs: [],
};

const RECIPE = { build: 'npm run build', entry: ['node', 'cli.js'] };

const fakeTransport: LlmTransport = async () => {
  throw new Error('the fake transport must never be invoked');
};

function writeFile(root: string, rel: string, body: string): void {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}

function okGenerateResult(): GuardGenerateResult {
  return {
    status: 'ok',
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
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
    orphanedDismissals: [],
  };
}

/** A fake generate that writes a scenario corpus + file report into the clone. */
function fakeGenerateWriting(result: GuardGenerateResult) {
  return vi.fn(async (dir: string) => {
    writeFile(dir, '.truecourse/scenarios/recipe.json', JSON.stringify(RECIPE));
    writeFile(dir, '.truecourse/scenarios/manifest.json', JSON.stringify({ guard: 1, sections: [] }));
    writeFile(
      dir,
      '.truecourse/scenarios/cli/s1.yaml',
      [
        'guard: 1',
        'id: s1',
        'title: t-s1',
        'binds:',
        '  doc: README.md',
        '  section: intro',
        '  fingerprint: "sha256:f"',
        'driver: cli',
        'steps:',
        '  - run: ["--help"]',
        '    expect:',
        '      exit: 0',
        '',
      ].join('\n'),
    );
    writeCloneGuardResult(dir, buildGuardReport(result, '2026-07-09T12:00:00.000Z'));
    return { guard: result };
  });
}

let client: PGlite;
let guardStore: PgGuardStore;

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as EeDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setSpecStore(new PgSpecStore(db));
  guardStore = new PgGuardStore(db);
  setGuardStore(guardStore);
  setDefaultTransport(fakeTransport);
});

afterEach(async () => {
  setDefaultTransport(undefined);
  resetSpecStore();
  resetGuardStore();
  await client.close();
});

describe('defaultGuardColdGenerate', () => {
  it('materializes the stored corpus, generates, persists under the ref, and returns the parsed corpus', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-cold-'));
    writeFile(dir, 'package.json', JSON.stringify({ name: 'fixture-under-test', version: '0.0.0', bin: { relkit: 'bin.mjs' } }));
    let sawCorpus = false;
    const inner = fakeGenerateWriting(okGenerateResult());
    const generate = vi.fn(async (d: string, t?: unknown) => {
      sawCorpus = fs.existsSync(path.join(d, '.truecourse', 'specs', 'corpus.json'));
      return inner(d, t as never);
    });
    try {
      const corpus = await defaultGuardColdGenerate(guardStore, ref, dir, generate);

      // The corpus was materialized before generation (it is the doc universe).
      expect(sawCorpus).toBe(true);
      // Returns the freshly parsed corpus for the same-pass run.
      expect(corpus).not.toBeNull();
      expect(corpus!.scenarios.map((s) => s.id)).toEqual(['s1']);
      expect(corpus!.recipe).toMatchObject({ entry: ['node', 'cli.js'] });
      // Persisted under the ref, so a later gate run is warm.
      expect(await guardStore.readRecipeRaw(REPO, SHA)).toContain('"entry"');
      expect((await guardStore.loadScenarios(ref)).scenarios.map((s) => s.id)).toEqual(['s1']);
      expect(await guardStore.readGuardResult(REPO, SHA)).not.toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the latest stored corpus when none is stored for the base commit', async () => {
    // The spec scan persisted the corpus under the SCAN-TIME default-branch
    // commit; the PR's base tip has since advanced past it, so the exact-commit
    // read misses. A scanned repo must still cold-generate — never go neutral
    // just because the branch moved inside the onboarding window.
    await saveSpec({ repoKey: REPO, commitSha: 'olderscan99' }, 'corpus', CORPUS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-cold-'));
    writeFile(dir, 'package.json', JSON.stringify({ name: 'fixture-under-test', version: '0.0.0', bin: { relkit: 'bin.mjs' } }));
    const generate = fakeGenerateWriting(okGenerateResult());
    try {
      const corpus = await defaultGuardColdGenerate(guardStore, ref, dir, generate);

      expect(generate).toHaveBeenCalled();
      expect(corpus).not.toBeNull();
      expect(corpus!.scenarios.map((s) => s.id)).toEqual(['s1']);
      // Scenarios still persist under the BASE sha (the gate's ref), not the scan commit.
      expect(await guardStore.readRecipeRaw(REPO, SHA)).toContain('"entry"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('copies birth-finding evidence out of the checkout so it resolves after cleanup', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-cold-'));
    writeFile(dir, 'package.json', JSON.stringify({ name: 'fixture-under-test', version: '0.0.0', bin: { relkit: 'bin.mjs' } }));
    const evidencePath = '.truecourse/guard/evidence/gen1234_abcd/s7';
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
    const inner = fakeGenerateWriting({ ...okGenerateResult(), birthFindings: [finding] });
    const generate = vi.fn(async (d: string, t?: unknown) => {
      // The birth run wrote its transcript into the checkout (removed after the gate).
      writeFile(d, `${evidencePath}/transcript.txt`, 'birth transcript');
      return inner(d, t as never);
    });
    try {
      expect(await defaultGuardColdGenerate(guardStore, ref, dir, generate)).not.toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // The checkout is gone, but the birth evidence resolves through the store.
    expect(await guardStore.readGuardEvidenceAt(REPO, evidencePath, 'transcript.txt')).toBe(
      'birth transcript',
    );
  });

  it('returns null (and persists nothing) when no curated corpus is stored', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-cold-'));
    writeFile(dir, 'package.json', JSON.stringify({ name: 'fixture-under-test', version: '0.0.0', bin: { relkit: 'bin.mjs' } }));
    const generate = vi.fn();
    try {
      expect(await defaultGuardColdGenerate(guardStore, ref, dir, generate)).toBeNull();
      expect(generate).not.toHaveBeenCalled();
      expect(await guardStore.readRecipeRaw(REPO, SHA)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propagates a generation failure (never a silent null), persisting nothing', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-cold-'));
    writeFile(dir, 'package.json', JSON.stringify({ name: 'fixture-under-test', version: '0.0.0', bin: { relkit: 'bin.mjs' } }));
    const generate = vi.fn(async () => ({
      guard: { ...okGenerateResult(), status: 'recipe-failed' as const, reason: 'no build recipe', written: [] },
    }));
    try {
      await expect(defaultGuardColdGenerate(guardStore, ref, dir, generate)).rejects.toThrow(
        'no build recipe',
      );
      expect(await guardStore.readRecipeRaw(REPO, SHA)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a proposal with install cold-generates: the install runs before the verification build', async () => {
    await saveSpec(ref, 'corpus', CORPUS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-cold-'));
    writeFile(dir, 'package.json', JSON.stringify({ name: 'fixture-under-test', version: '0.0.0', bin: { relkit: 'bin.mjs' } }));
    // A "fresh checkout": the doc tree only — no node_modules, nothing built.
    writeFile(dir, 'README.md', '## version\n`--version` prints the version and exits 0.\n');
    const FIXTURE_BIN = fileURLToPath(new URL('../fixtures/guard-fixture-cli/bin.mjs', import.meta.url));
    const extract: ExtractRunner = async ({ outline }) => ({
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
    const author: GenerateRunner = async ({ claims }) => ({
      claims: claims.map((c) => ({
        ref: c.ref,
        scenarios: [
          { title: 'version works', driver: 'cli' as const, steps: [{ run: ['--version'], expect: { exit: 0 } }] },
        ],
      })),
    });
    // The REAL generate: the verification/birth build only succeeds after install.
    const generate = async (d: string) => ({
      guard: await generateGuards({
        repoRoot: d,
        recipeRunner: async () => ({
          install: 'touch install-marker',
          build: 'test -f install-marker',
          entry: ['node', FIXTURE_BIN],
        }),
        extractRunner: extract,
        generateRunner: author,
        fidelityRunner: async () => ({ verdict: 'faithful' as const }),
      }),
    });
    try {
      const corpus = await defaultGuardColdGenerate(guardStore, ref, dir, generate);

      expect(corpus).not.toBeNull();
      expect(corpus!.recipe).toMatchObject({ install: 'touch install-marker' });
      expect(corpus!.scenarios).toHaveLength(1);
      // The discovered recipe persisted under the ref WITH its install step.
      expect(await guardStore.readRecipeRaw(REPO, SHA)).toContain('"install": "touch install-marker"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails loudly when no LLM provider is configured (before generating)', async () => {
    setDefaultTransport(undefined);
    await saveSpec(ref, 'corpus', CORPUS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-cold-'));
    writeFile(dir, 'package.json', JSON.stringify({ name: 'fixture-under-test', version: '0.0.0', bin: { relkit: 'bin.mjs' } }));
    const generate = vi.fn();
    try {
      await expect(defaultGuardColdGenerate(guardStore, ref, dir, generate)).rejects.toThrow(
        /No LLM provider is configured/,
      );
      expect(generate).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

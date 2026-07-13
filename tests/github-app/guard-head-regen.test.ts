/**
 * Guard head-regen pipeline: re-scan the PR head's spec docs into a fresh corpus,
 * generate scenarios, persist them under the HEAD commit, and return the parsed
 * corpus for the re-gate. Exercises the REAL pipeline body over PGlite-backed
 * spec/guard stores, faking only the clone / scan / generate seams.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
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
import type { GuardGenerateResult } from '@truecourse/guard-generator';
import type { GithubAuth } from '../../ee/packages/github-app/src/github';
import {
  createGuardHeadRegenPipeline,
  checkoutPinnedHead,
  type GuardHeadRegenRequest,
} from '../../ee/packages/github-app/src/guard-head-regen';

const REPO = 'acme/api';
const HEAD_SHA = 'headsha123456';
const ref: RepoRef = { repoKey: REPO, commitSha: HEAD_SHA };

const CORPUS = {
  version: 3,
  generatedAt: '2026-07-09T00:00:00.000Z',
  docs: [{ ref: 'README.md', areaTags: ['cli'] }],
  areas: [],
  relations: [],
  skippedDocs: [],
};

const request: GuardHeadRegenRequest = {
  repoFullName: REPO,
  installationId: 42,
  prNumber: 7,
  baseBranch: 'main',
  headSha: HEAD_SHA,
};

const deps = { auth: {} as GithubAuth };

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
    heldSections: [],
    orphanedDismissals: [],
  };
}

/** Fake generate that writes a scenario corpus + report into the checkout. */
function fakeGenerateWriting(result: GuardGenerateResult) {
  return vi.fn(async (dir: string) => {
    writeFile(dir, '.truecourse/scenarios/recipe.json', JSON.stringify({ build: 'npm run build', entry: ['node', 'cli.js'] }));
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

/** Fake scan that writes the head's fresh corpus.json into the checkout + store. */
function fakeScan() {
  return vi.fn(async (dir: string, r: RepoRef) => {
    writeFile(dir, '.truecourse/specs/corpus.json', JSON.stringify(CORPUS));
    await saveSpec(r, 'corpus', CORPUS);
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

describe('guard head-regen pipeline', () => {
  it('clones the head, scans it, generates, persists under the head, and returns the parsed corpus', async () => {
    let scannedThenGenerated = false;
    const clone = vi.fn(async () => {});
    const scan = fakeScan();
    const inner = fakeGenerateWriting(okGenerateResult());
    const generate = vi.fn(async (dir: string, t?: unknown) => {
      // The head's fresh corpus.json must be in place before generation.
      scannedThenGenerated = fs.existsSync(path.join(dir, '.truecourse', 'specs', 'corpus.json'));
      return inner(dir, t as never);
    });
    const pipeline = createGuardHeadRegenPipeline({ clone, scan, generate });

    const result = await pipeline.run(deps, request);

    expect(scannedThenGenerated).toBe(true);
    expect(result.noCorpus).toBe(false);
    expect(result.scenariosWritten).toBe(1);
    expect(result.corpus?.scenarios.map((s) => s.id)).toEqual(['s1']);
    // Persisted under the HEAD commit so the re-gate is warm for it.
    expect(await guardStore.readRecipeRaw(REPO, HEAD_SHA)).toContain('"entry"');
    expect((await guardStore.loadScenarios(ref)).scenarios.map((s) => s.id)).toEqual(['s1']);
  });

  it('copies birth-finding evidence out of the head checkout so it resolves after cleanup', async () => {
    const RUN_ID = 'gen9876_wxyz';
    const evidencePath = `.truecourse/guard/evidence/${RUN_ID}/s3`;
    const finding = {
      doc: 'README.md',
      anchor: 'intro',
      kind: 'birth' as const,
      title: 'shows help',
      step: 1,
      expected: 'exit 0',
      actual: 'exit 2',
      evidencePath,
    };
    const clone = vi.fn(async () => {});
    const scan = fakeScan();
    const generate = vi.fn(async (dir: string) => {
      writeFile(dir, '.truecourse/scenarios/recipe.json', JSON.stringify({ build: 'npm run build', entry: ['node', 'cli.js'] }));
      writeFile(dir, '.truecourse/scenarios/manifest.json', JSON.stringify({ guard: 1, sections: [] }));
      writeFile(dir, '.truecourse/scenarios/cli/s1.yaml', 'guard: 1\nid: s1\n');
      writeFile(dir, `${evidencePath}/transcript.txt`, 'head birth transcript');
      const result = { ...okGenerateResult(), birthFindings: [finding] };
      writeCloneGuardResult(dir, buildGuardReport(result, '2026-07-09T12:00:00.000Z'));
      return { guard: result };
    });
    const pipeline = createGuardHeadRegenPipeline({ clone, scan, generate });

    const result = await pipeline.run(deps, request);
    expect(result.noCorpus).toBe(false);

    // Persisted under the head commit, resolvable after the checkout is removed.
    const report = await guardStore.readGuardResult(REPO, HEAD_SHA);
    expect(report!.birthFindings[0]!.evidencePath).toBe(evidencePath);
    expect(await guardStore.readGuardEvidenceAt(REPO, evidencePath, 'transcript.txt')).toBe('head birth transcript');
  });

  it('a head with no doc universe after scan is a clean noCorpus no-op (no generate, no persist)', async () => {
    const clone = vi.fn(async () => {});
    // A scan that finds no docs writes no corpus.json.
    const scan = vi.fn(async () => {});
    const generate = vi.fn();
    const pipeline = createGuardHeadRegenPipeline({ clone, scan, generate });

    const result = await pipeline.run(deps, request);

    expect(result).toEqual({ scenariosWritten: 0, noCorpus: true, corpus: null });
    expect(generate).not.toHaveBeenCalled();
    expect(await guardStore.readRecipeRaw(REPO, HEAD_SHA)).toBeNull();
  });

  it('propagates a generation failure (never a silent no-op), persisting nothing', async () => {
    const clone = vi.fn(async () => {});
    const scan = fakeScan();
    const generate = vi.fn(async () => ({
      guard: { ...okGenerateResult(), status: 'recipe-failed' as const, reason: 'no build recipe', written: [] },
    }));
    const pipeline = createGuardHeadRegenPipeline({ clone, scan, generate });

    await expect(pipeline.run(deps, request)).rejects.toThrow('no build recipe');
    expect(await guardStore.readRecipeRaw(REPO, HEAD_SHA)).toBeNull();
  });

  it('persists through the injected guard store, not the process-global one', async () => {
    // A second, independent PGlite-backed store stands in for the injected seam;
    // the process-global store (set in beforeEach) must stay untouched.
    const client2 = new PGlite();
    const db2 = drizzle(client2, { schema }) as unknown as EeDb;
    await migrate(db2, { migrationsFolder: MIGRATIONS_DIR });
    const injected = new PgGuardStore(db2);
    try {
      const pipeline = createGuardHeadRegenPipeline({
        clone: vi.fn(async () => {}),
        scan: fakeScan(),
        generate: fakeGenerateWriting(okGenerateResult()),
        guardStore: injected,
      });

      const result = await pipeline.run(deps, request);

      expect(result.noCorpus).toBe(false);
      expect(result.scenariosWritten).toBe(1);
      expect(result.corpus?.scenarios.map((s) => s.id)).toEqual(['s1']);
      expect(await injected.readRecipeRaw(REPO, HEAD_SHA)).toContain('"entry"');
      // The process-global store saw none of it.
      expect(await guardStore.readRecipeRaw(REPO, HEAD_SHA)).toBeNull();
    } finally {
      await client2.close();
    }
  });
});

/** Run git in `cwd` with a deterministic identity, returning trimmed stdout. */
function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8' }).trim();
}
const GIT = 'git -c user.email=t@test -c user.name=t -c commit.gpgsign=false';

describe('checkoutPinnedHead', () => {
  it('pins the checkout to the enqueue-time head when the pull ref has moved past it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-head-pin-'));
    try {
      // Remote: base commit on main; PR commits A then B, published only via the
      // pull ref (which points at the NEW head B, as after a post-tick push).
      const remote = path.join(root, 'remote');
      fs.mkdirSync(remote);
      sh('git init -b main', remote);
      sh(`${GIT} commit --allow-empty -m base`, remote);
      fs.writeFileSync(path.join(remote, 'a.txt'), 'A');
      sh('git add a.txt', remote);
      sh(`${GIT} commit -m A`, remote);
      const shaA = sh('git rev-parse HEAD', remote);
      fs.writeFileSync(path.join(remote, 'b.txt'), 'B');
      sh('git add b.txt', remote);
      sh(`${GIT} commit -m B`, remote);
      const shaB = sh('git rev-parse HEAD', remote);
      sh(`git update-ref refs/pull/7/head ${shaB}`, remote);
      sh('git reset --hard HEAD~2', remote); // main back at base — A/B live only on the pull ref
      // Let the pinning fetch request A by sha (GitHub allows this; plain git needs the flag).
      sh('git config uploadpack.allowreachablesha1inwant true', remote);

      // The clone half of defaultClone: shallow base clone + pull-ref fetch.
      const clone = path.join(root, 'clone');
      sh(`git clone --depth 1 --branch main file://${remote} ${clone}`, root);
      sh('git fetch --depth 1 origin refs/pull/7/head', clone);
      expect(sh('git rev-parse FETCH_HEAD', clone)).toBe(shaB); // the ref moved

      // The pin must land on the ENQUEUE-TIME head A, not FETCH_HEAD (B).
      await checkoutPinnedHead(clone, [], shaA);

      expect(sh('git rev-parse HEAD', clone)).toBe(shaA);
      expect(fs.existsSync(path.join(clone, 'a.txt'))).toBe(true);
      expect(fs.existsSync(path.join(clone, 'b.txt'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('checks out FETCH_HEAD directly when it already is the requested head', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-head-pin-'));
    try {
      const remote = path.join(root, 'remote');
      fs.mkdirSync(remote);
      sh('git init -b main', remote);
      sh(`${GIT} commit --allow-empty -m base`, remote);
      fs.writeFileSync(path.join(remote, 'a.txt'), 'A');
      sh('git add a.txt', remote);
      sh(`${GIT} commit -m A`, remote);
      const shaA = sh('git rev-parse HEAD', remote);
      sh(`git update-ref refs/pull/7/head ${shaA}`, remote);
      sh('git reset --hard HEAD~1', remote);

      const clone = path.join(root, 'clone');
      sh(`git clone --depth 1 --branch main file://${remote} ${clone}`, root);
      sh('git fetch --depth 1 origin refs/pull/7/head', clone);

      await checkoutPinnedHead(clone, [], shaA);

      expect(sh('git rev-parse HEAD', clone)).toBe(shaA);
      expect(fs.existsSync(path.join(clone, 'a.txt'))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

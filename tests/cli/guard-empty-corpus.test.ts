/**
 * Empty-corpus surfaces on the `guard` CLI (issue #807):
 *   - `guard generate` (item 8) — a present-but-empty corpus is a no-docs FAILURE
 *      with a DISTINCT reason (the shared empty-corpus wording, never "run spec
 *      scan first" — that loops); a MISSING corpus keeps the spec-scan pointer.
 *   - `guard run` (item 9) — a no-scenarios run over an empty corpus adds ONE info
 *      line explaining WHY before "Nothing ran." (runFailureMessage stays pure).
 *   - `guard status` (item 10) — with no coverage manifest and an empty corpus, the
 *      "coverage (none) — run guard generate" hint is replaced by the empty-corpus
 *      line; a missing corpus keeps the hint.
 * All read the persisted corpus.json through the shared derivation.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { runGuardGenerate, runGuardRun, runGuardStatus } from '../../tools/cli/src/commands/guard';
import { makeTempRepo, rmrf } from '../guard-generator/helpers.js';
import { writeRecipe as writeRunRecipe } from '../guard-runner/helpers.js';

const repos: string[] = [];
const homes: string[] = [];
function repo(): string {
  const r = makeTempRepo();
  repos.push(r);
  execSync('git init -q -b main', { cwd: r });
  return r;
}
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!);
  while (homes.length) rmrf(homes.pop()!);
  delete process.env.TRUECOURSE_HOME;
});

/** Seed a committable corpus.json with 0 kept docs and the given scan stats. */
function writeEmptyCorpus(
  r: string,
  over: {
    skippedDocs?: { ref: string; reason: string }[];
    stats?: { docsScanned: number; docsKept: number; ignoredNonMarkdown?: Record<string, number> };
  } = {},
): void {
  const dir = path.join(r, '.truecourse', 'specs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'corpus.json'),
    JSON.stringify({
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [],
      areas: [],
      skippedDocs: over.skippedDocs ?? [],
      ...(over.stats ? { stats: over.stats } : {}),
    }),
  );
}

/** Run a guard command capturing stdout (clack) + stderr (renderer) + exit code. */
async function captureGuard(fn: () => Promise<void>): Promise<{ out: string; err: string; exit: number | null }> {
  let exit: number | null = null;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exit = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as never);
  const cap = (chunks: string[]) =>
    ((chunk: unknown, ...rest: unknown[]) => {
      chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
      const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
      cb?.();
      return true;
    }) as never;
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(cap(outChunks));
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(cap(errChunks));
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e;
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  return { out: strip(outChunks.join('')), err: strip(errChunks.join('')), exit };
}

function withHome(): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-empty-home-'));
  homes.push(home);
  process.env.TRUECOURSE_HOME = home;
}

// ---------------------------------------------------------------------------
// item 8 — guard generate
// ---------------------------------------------------------------------------

describe('runGuardGenerate — empty corpus (item 8)', () => {
  it('a present-but-empty corpus fails with the empty-corpus reason and NEVER loops back to `spec scan`', async () => {
    const r = repo();
    withHome();
    writeEmptyCorpus(r, { stats: { docsScanned: 0, docsKept: 0, ignoredNonMarkdown: { '.rst': 4 } } });

    const io = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-io-'));
    const { out, exit } = await captureGuard(() => runGuardGenerate({ cwd: r, llmTransport: 'agent', io, yes: true }));
    rmrf(io);

    expect(out).toContain('No spec documents found');
    expect(out).toContain('Ignored 4 .rst files.');
    // The distinct empty-corpus path must not send the user back to `spec scan`.
    expect(out).not.toMatch(/spec scan/);
    expect(exit).toBe(1);
  });

  it('a MISSING corpus keeps the current "Run `truecourse spec scan` first" pointer', async () => {
    const r = repo();
    withHome();
    // No corpus.json at all.
    const io = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-io-'));
    const { out, exit } = await captureGuard(() => runGuardGenerate({ cwd: r, llmTransport: 'agent', io, yes: true }));
    rmrf(io);

    expect(out).toContain('spec scan');
    expect(out).not.toContain('No spec documents found');
    expect(exit).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// item 9 — guard run (no scenarios)
// ---------------------------------------------------------------------------

describe('runGuardRun — no scenarios over an empty corpus (item 9)', () => {
  it('adds an info line explaining the empty corpus before "Nothing ran.", exit 0', async () => {
    const r = repo();
    writeRunRecipe(r); // a recipe but no scenario files → no-scenarios
    writeEmptyCorpus(r, { stats: { docsScanned: 0, docsKept: 0, ignoredNonMarkdown: { '.rst': 9 } } });

    const { out, exit } = await captureGuard(() => runGuardRun({ cwd: r }));

    expect(out).toContain('No scenarios found');
    expect(out).toContain('No spec documents found');
    expect(out).toContain('Ignored 9 .rst files.');
    expect(out).toContain('Nothing ran.');
    expect(exit).toBe(0);
  });

  it('a MISSING corpus adds no empty-corpus line (just the plain no-scenarios message)', async () => {
    const r = repo();
    writeRunRecipe(r);
    const { out, exit } = await captureGuard(() => runGuardRun({ cwd: r }));
    expect(out).toContain('No scenarios found');
    expect(out).not.toContain('No spec documents found');
    expect(exit).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// item 10 — guard status (no coverage manifest)
// ---------------------------------------------------------------------------

describe('runGuardStatus — empty corpus, no coverage (item 10)', () => {
  it('replaces the coverage hint with the empty-corpus line', async () => {
    const r = repo();
    writeEmptyCorpus(r, { stats: { docsScanned: 0, docsKept: 0, ignoredNonMarkdown: { '.adoc': 2 } } });

    const { out } = await captureGuard(() => runGuardStatus({ cwd: r }));

    expect(out).toContain('No spec documents found');
    expect(out).toContain('Ignored 2 .adoc files.');
    // The old "coverage (none) — run guard generate" hint is gone for an empty corpus.
    expect(out).not.toContain('coverage    (none) — run `truecourse guard generate`');
  });

  it('a MISSING corpus keeps the "coverage (none) — run `truecourse guard generate`" hint', async () => {
    const r = repo();
    const { out } = await captureGuard(() => runGuardStatus({ cwd: r }));
    expect(out).toContain('coverage    (none) — run `truecourse guard generate`');
    expect(out).not.toContain('No spec documents found');
  });
});

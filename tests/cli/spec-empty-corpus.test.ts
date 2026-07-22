/**
 * Empty-corpus surfaces on the `spec` CLI (issue #807):
 *   - `spec scan`  (item 6) — an empty corpus is a LOUD warning + exit 0, never the
 *                  false "Nothing changed" success and never the "run guard generate"
 *                  outro. curateInProcess is mocked to the two empty-corpus flavors.
 *   - `spec status` (item 7) — a persisted corpus with 0 docs prints the
 *                  flavor-appropriate warning and an outro that never says
 *                  "guard generate".
 * Both render the ONE shared formatter (`@truecourse/shared`), so the wording is
 * asserted here only for the pieces the surface is responsible for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return { ...actual, curateInProcess: vi.fn() };
});

import { runSpecScan, runSpecStatus } from '../../tools/cli/src/commands/spec.js';
import { curateInProcess } from '@truecourse/core/commands/spec-in-process';

let repo: string;
let home: string;
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

async function capture(fn: () => Promise<void>): Promise<{ out: string; exit: number | null }> {
  const chunks: string[] = [];
  let exit: number | null = null;
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: any) => {
    chunks.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exit = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as never);
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e;
  } finally {
    outSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { out: stripAnsi(chunks.join('')), exit };
}

/** A minimal committable corpus.json with 0 kept docs and the given scan stats. */
function writeEmptyCorpus(over: {
  skippedDocs?: { ref: string; reason: string }[];
  stats?: { docsScanned: number; docsKept: number; ignoredNonMarkdown?: Record<string, number> };
}): void {
  const corpus = {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [],
    areas: [],
    skippedDocs: over.skippedDocs ?? [],
    ...(over.stats ? { stats: over.stats } : {}),
  };
  fs.writeFileSync(path.join(repo, '.truecourse', 'specs', 'corpus.json'), JSON.stringify(corpus));
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-empty-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-empty-home-'));
  process.env.TRUECOURSE_HOME = home;
  fs.mkdirSync(path.join(repo, '.truecourse', 'specs'), { recursive: true });
  execSync('git init -q -b main', { cwd: repo });
  vi.mocked(curateInProcess).mockReset();
});
afterEach(() => {
  delete process.env.TRUECOURSE_HOME;
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// item 6 — spec scan
// ---------------------------------------------------------------------------

describe('runSpecScan — empty corpus (item 6)', () => {
  it("'no-docs-found' warns with the ignored-extension breakdown, exits 0, never says 'Nothing changed' or 'guard generate'", async () => {
    vi.mocked(curateInProcess).mockResolvedValue({
      curate: { stats: { docsScanned: 0, docsKept: 0, ignoredNonMarkdown: { '.rst': 23, '.adoc': 2 } } },
      noChanges: false,
      emptyCorpus: 'no-docs-found',
    } as never);

    const { out, exit } = await capture(() => runSpecScan({ cwd: repo, llm: 'agent', io: repo, yes: true }));

    expect(out).toContain('No spec documents found');
    expect(out).toContain('Ignored 23 .rst, 2 .adoc files.');
    expect(out).not.toContain('Nothing changed');
    expect(out).not.toContain('guard generate');
    expect(out).not.toContain('Corpus written');
    // exit 0: the command returned; process.exit was not invoked with a failure.
    expect(exit).toBeNull();
  });

  it("'all-docs-dropped' warns that every scanned doc was dropped, never points at 'guard generate'", async () => {
    vi.mocked(curateInProcess).mockResolvedValue({
      curate: { stats: { docsScanned: 7, docsKept: 0, ignoredNonMarkdown: {} } },
      noChanges: false,
      emptyCorpus: 'all-docs-dropped',
    } as never);

    const { out } = await capture(() => runSpecScan({ cwd: repo, llm: 'agent', io: repo, yes: true }));

    expect(out).toContain('Scanned 7 docs but kept none');
    expect(out).not.toContain('Nothing changed');
    expect(out).not.toContain('guard generate');
  });
});

// ---------------------------------------------------------------------------
// item 7 — spec status
// ---------------------------------------------------------------------------

describe('runSpecStatus — empty corpus (item 7)', () => {
  it("'no-docs-found' (persisted stats) warns and the outro never says 'guard generate'", async () => {
    writeEmptyCorpus({ stats: { docsScanned: 0, docsKept: 0, ignoredNonMarkdown: { '.rst': 5 } } });
    const { out } = await capture(() => runSpecStatus({ cwd: repo }));
    expect(out).toContain('No spec documents found');
    expect(out).toContain('Ignored 5 .rst files.');
    expect(out).not.toContain('guard generate');
  });

  it("'all-docs-dropped' (0 kept, N skipped) warns about the relevance drop, no 'guard generate'", async () => {
    writeEmptyCorpus({
      stats: { docsScanned: 3, docsKept: 0, ignoredNonMarkdown: {} },
      skippedDocs: [
        { ref: 'docs/a.md', reason: 'not spec-relevant' },
        { ref: 'docs/b.md', reason: 'not spec-relevant' },
        { ref: 'docs/c.md', reason: 'not spec-relevant' },
      ],
    });
    const { out } = await capture(() => runSpecStatus({ cwd: repo }));
    expect(out).toContain('Scanned 3 docs but kept none');
    expect(out).not.toContain('guard generate');
  });

  it('a legacy empty corpus without stats still derives all-docs-dropped from skippedDocs', async () => {
    // No `stats` block (older corpus) — docsScanned falls back to kept + skipped.
    writeEmptyCorpus({ skippedDocs: [{ ref: 'docs/a.md', reason: 'dropped' }] });
    const { out } = await capture(() => runSpecStatus({ cwd: repo }));
    expect(out).toContain('Scanned 1 docs but kept none');
    expect(out).not.toContain('guard generate');
  });
});

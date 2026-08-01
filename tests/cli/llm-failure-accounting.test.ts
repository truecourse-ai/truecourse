/**
 * The CLI surface of LLM-failure accounting: a stage that lost EVERY call aborts
 * the command loudly with a non-zero exit (a CI gate can never read it as a clean
 * no-op), and a run that lost SOME calls completes but never prints an unqualified
 * success line. The command runs for real against an injected transport — only the
 * `claude`/API preflight is stubbed (it would otherwise exit first).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

vi.mock('../../tools/cli/src/lib/claude-preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tools/cli/src/lib/claude-preflight.js')>();
  return { ...actual, preflightLlmOrExit: vi.fn(async () => {}) };
});

import { setDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';
import { corpusFilePath } from '../../packages/spec-consolidator/src/index.js';
import { runSpecScan } from '../../tools/cli/src/commands/spec.js';
import { makeTempRepo, rmrf, writeDoc } from '../guard-generator/helpers.js';

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Run a command, capturing stdout + stderr and the exit code it asked for. */
async function capture(fn: () => Promise<void>): Promise<{ out: string; exitCode: number | null }> {
  let exitCode: number | null = null;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as never);
  const chunks: string[] = [];
  const sink = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    cb?.();
    return true;
  }) as never;
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(sink);
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(sink);
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e;
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { out: stripAnsi(chunks.join('')), exitCode };
}

const repos: string[] = [];
let home: string;
let priorHome: string | undefined;

beforeEach(() => {
  // Keep the user-level registry/config writes (registerProject, the remembered
  // generate mode) inside the test.
  priorHome = process.env.TRUECOURSE_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-home-'));
  process.env.TRUECOURSE_HOME = home;
});
afterEach(() => {
  setDefaultTransport(undefined);
  if (priorHome === undefined) delete process.env.TRUECOURSE_HOME;
  else process.env.TRUECOURSE_HOME = priorHome;
  fs.rmSync(home, { recursive: true, force: true });
  while (repos.length) rmrf(repos.pop()!);
});

function repo(): string {
  const r = makeTempRepo();
  repos.push(r);
  execSync('git init -q -b main', { cwd: r });
  return r;
}

// ---------------------------------------------------------------------------
// spec scan
// ---------------------------------------------------------------------------

const SPEC_DOCS: Array<[string, string]> = [
  ['docs/orders.md', '# Orders\nAn order is created with a POST to /orders and returns 201.'],
  ['docs/auth.md', '# Auth\nEvery request carries a Bearer JWT; an expired token gets a 401.'],
  ['docs/billing.md', '# Billing\nAn invoice is issued monthly and dunning retries three times.'],
];

function seedSpecRepo(): string {
  const r = repo();
  for (const [rel, content] of SPEC_DOCS) writeDoc(r, rel, content);
  return r;
}

/** The area-tag answer for a doc — a distinct concern per doc, so no doc PAIR shares
 *  an area and the overlap stage makes no calls. */
function areaAnswerFor(id: string | undefined): string {
  const concern = (id ?? '').split('/').pop()?.replace('.md', '') ?? 'core';
  return JSON.stringify({ areas: [{ product: 'core', concern }], status: null });
}

describe('spec scan — every relevance call failed', () => {
  it('aborts with a non-zero exit and leaves the previous corpus.json untouched', async () => {
    const r = seedSpecRepo();
    const file = corpusFilePath(r);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const prior = JSON.stringify({ version: 3, generatedAt: '2026-01-01T00:00:00Z', docs: [], areas: [], skippedDocs: [] });
    fs.writeFileSync(file, prior);

    setDefaultTransport(async () => {
      throw new Error("Invalid schema for response_format 'response': Missing 'reason'.");
    });
    const { out, exitCode } = await capture(() => runSpecScan({ cwd: r, yes: true }));

    expect(exitCode).toBe(1);
    expect(out).toContain('Scan aborted');
    expect(out).toContain('spec.relevance');
    expect(out).toContain("Missing 'reason'");
    expect(out).toContain('unchanged');
    expect(out).not.toContain('Done.');
    expect(fs.readFileSync(file, 'utf-8')).toBe(prior);
  });
});

describe('spec scan — one relevance call failed', () => {
  it('writes the corpus, reports the stage counts + the kept-by-default effect, and qualifies the close', async () => {
    const r = seedSpecRepo();
    const failing: LlmTransport = async (req) => {
      if (req.stage === 'spec.relevance') {
        if (req.id?.includes('auth.md')) throw new Error('claude API error (api 429): usage limit reached');
        return '{"include":true,"reason":"spec"}';
      }
      if (req.stage === 'spec.areaTag') return areaAnswerFor(req.id);
      return '{}';
    };
    setDefaultTransport(failing);

    const { out, exitCode } = await capture(() => runSpecScan({ cwd: r, yes: true }));

    expect(exitCode).toBeNull();
    expect(out).toContain('LLM calls failed');
    expect(out).toContain('relevance: 1 of 3 calls failed — affected docs kept by default');
    expect(out).toContain('first failure: claude API error (api 429): usage limit reached');
    // The close never reads as an unqualified success.
    expect(out).toContain('INCOMPLETE');
    expect(fs.existsSync(corpusFilePath(r))).toBe(true);
  });
});

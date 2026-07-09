import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The contracts/verify pipeline (`contracts`, `verify`, `infer`, `drifts`) is
// discontinued in favor of `guard` (SPEC_GUARD_PLAN item 24): each command stays
// registered and functional but prints a one-line deprecation notice on stderr
// and is hidden from `--help`. These are true end-to-end checks — they spawn the
// real CLI entrypoint (index.ts, where the notice + hiding live) via tsx, since
// the notice is wired into commander's action handlers, not the command modules.

const REPO_ROOT = path.resolve(__dirname, '../..');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const CLI_ENTRY = path.join(REPO_ROOT, 'tools', 'cli', 'src', 'index.ts');

let home: string;

beforeAll(() => {
  // Isolate the global registry/config so a spawned command can't touch ~/.truecourse.
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-discontinued-home-'));
});
afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function notice(command: string): string {
  return `⚠ \`${command}\` is discontinued in favor of \`truecourse guard\` — see the README. Planned removal: 0.8.`;
}

function runCli(args: string[], cwd: string): { stdout: string; stderr: string; status: number | null } {
  const res = spawnSync(TSX_BIN, [CLI_ENTRY, ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      TRUECOURSE_HOME: home,
      TRUECOURSE_NO_PRICE_FETCH: '1',
      CI: 'true',
    },
    timeout: 60_000,
  });
  if (res.error) throw res.error;
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status };
}

/** A fresh, non-git temp dir so verify/infer/contracts short-circuit fast (no LLM). */
function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tc-discontinued-'));
}

/** Command names commander lists under the `Commands:` section of `--help`. */
function listedCommands(help: string): string[] {
  const start = help.indexOf('Commands:');
  const section = start >= 0 ? help.slice(start) : help;
  const names: string[] = [];
  for (const line of section.split('\n')) {
    // Command rows start at exactly 2 spaces; wrapped description lines are
    // indented further (a space sits at column 3), so they don't match.
    const m = /^ {2}(\S+)/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

describe('discontinued CLI commands — deprecation notice', () => {
  // Each case: the invocation, the label the notice must carry (always the
  // top-level command), a stable stdout marker proving normal behavior still
  // runs, and the unchanged exit code. In a non-git dir verify/infer/contracts
  // generate short-circuit at the git guard; the read-only lists just run.
  const CASES: Array<{
    name: string;
    args: string[];
    label: string;
    stdoutMarker: string;
    exit: number;
  }> = [
    { name: 'verify', args: ['verify'], label: 'verify', stdoutMarker: 'not a git repository', exit: 1 },
    { name: 'infer', args: ['infer'], label: 'infer', stdoutMarker: 'not a git repository', exit: 1 },
    { name: 'contracts list', args: ['contracts', 'list'], label: 'contracts', stdoutMarker: 'No contracts found', exit: 0 },
    { name: 'contracts validate', args: ['contracts', 'validate'], label: 'contracts', stdoutMarker: 'No .truecourse/contracts', exit: 1 },
    { name: 'contracts generate --diff', args: ['contracts', 'generate', '--diff'], label: 'contracts', stdoutMarker: 'not a git repository', exit: 1 },
    { name: 'drifts list', args: ['drifts', 'list'], label: 'drifts', stdoutMarker: 'No verify results yet', exit: 0 },
  ];

  it.each(CASES)('`$name` prints the notice first on stderr and still runs', ({ args, label, stdoutMarker, exit }) => {
    const { stdout, stderr, status } = runCli(args, tmpDir());

    // (a) the deprecation line is the very first thing on stderr...
    expect(stderr.split('\n')[0]).toBe(notice(label));
    // ...and appears exactly once per invocation, not per internal call.
    expect(stderr.match(/is discontinued/g) ?? []).toHaveLength(1);
    // (b) normal behavior + exit code are unchanged (notice doesn't abort/alter).
    expect(stdout).toContain(stdoutMarker);
    expect(status).toBe(exit);
  });
});

describe('discontinued CLI commands — hidden from --help', () => {
  it('lists guard/spec/analyze but not contracts/verify/infer/drifts', () => {
    const { stdout, status } = runCli(['--help'], REPO_ROOT);
    expect(status).toBe(0);
    const names = listedCommands(stdout);

    expect(names).toEqual(expect.arrayContaining(['analyze', 'spec', 'guard']));
    for (const hidden of ['contracts', 'verify', 'infer', 'drifts']) {
      expect(names).not.toContain(hidden);
    }
  });
});

describe('active CLI commands — no deprecation notice', () => {
  // Especially `guard drifts`: a subcommand that shares the discontinued
  // top-level `drifts` name must NOT inherit the notice.
  it.each([['guard', 'status'], ['guard', 'drifts'], ['spec', 'status'], ['list']])(
    '`%s %s` prints no discontinuation notice',
    (...args: string[]) => {
      const { stderr } = runCli(args, tmpDir());
      expect(stderr).not.toContain('is discontinued');
    },
  );
});

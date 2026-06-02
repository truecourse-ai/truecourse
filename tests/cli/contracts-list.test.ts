import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runContractsList } from '../../tools/cli/src/commands/contracts';

// Real authored + inferred .tc, so the parser/resolver see valid artifacts.
const FIXTURE_CONTRACTS = path.resolve(
  __dirname,
  '../fixtures/sample-js-project-il/reference/contracts',
);

let repo: string;
let out: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-contracts-list-'));
  fs.cpSync(FIXTURE_CONTRACTS, path.join(repo, '.truecourse', 'contracts'), { recursive: true });
  out = '';
  // clack (p.intro/p.log/p.outro) writes via process.stdout.write; the per-artifact
  // lines use console.log — capture both.
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out += args.map(String).join(' ') + '\n';
  });
});
afterEach(() => {
  stdoutSpy.mockRestore();
  logSpy.mockRestore();
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('runContractsList', () => {
  it('default lists both authored and inferred artifacts', async () => {
    await runContractsList({ cwd: repo });
    expect(out).toContain('Operation:GET /api/orders'); // authored
    expect(out).toContain('Operation:GET /api/loyalty-tiers'); // inferred
  });

  it('--inferred shows only inferred, with [confidence] + code location', async () => {
    await runContractsList({ cwd: repo, inferred: true });
    expect(out).toContain('[high] Operation:GET /api/loyalty-tiers');
    expect(out).toContain('src/controllers/customers.controller.ts:53');
    expect(out).toContain('[high] NamedConstant:RATE_LIMIT_PER_MINUTE');
    expect(out).not.toContain('/api/orders'); // authored excluded
  });

  it('--authored excludes _inferred/', async () => {
    await runContractsList({ cwd: repo, authored: true });
    expect(out).toContain('Operation:GET /api/orders');
    expect(out).not.toContain('/api/loyalty-tiers');
    expect(out).not.toContain('[high]'); // confidence is inferred-only
  });

  it('reports nothing-to-show when a filter matches no artifacts', async () => {
    fs.rmSync(path.join(repo, '.truecourse', 'contracts', '_inferred'), { recursive: true, force: true });
    await runContractsList({ cwd: repo, inferred: true });
    expect(out).toContain('No inferred contracts');
  });
});

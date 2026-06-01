/**
 * Inference engine unit behaviours: authored-coverage subtraction (a
 * documented decision drops out), inferred-from provenance round-trips
 * through the resolver, and `writeInferred` is idempotent + prunes stale
 * files. The per-kind extraction is exercised end-to-end in
 * infer-fixture.test.ts; here we pin the engine's contracts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { infer, writeInferred } from '../../packages/contract-verifier/src/infer/index.js';
import { renderDecision } from '../../packages/contract-verifier/src/infer/serialize.js';
import { parseFile } from '../../packages/contract-verifier/src/parser/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';

const JS_FIXTURE = path.resolve(__dirname, '../fixtures/sample-js-project-il');
const CONTRACTS = path.join(JS_FIXTURE, 'reference/contracts');
const CODE = path.join(JS_FIXTURE, 'code');

describe('inference — authored coverage subtraction', () => {
  it('infers a policy constant the spec does not document', async () => {
    const res = await infer({ contractsDir: CONTRACTS, codeDir: CODE });
    const names = res.decisions.filter((d) => d.kind === 'NamedConstant').map((d) => d.identity);
    expect(names).toContain('RATE_LIMIT_PER_MINUTE');
  });

  it('drops a decision once an authored contract covers it', async () => {
    // A contracts dir whose ONLY authored artifact documents the constant.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-infer-cov-'));
    fs.writeFileSync(
      path.join(tmp, 'rate-limit.tc'),
      `constant RATE_LIMIT_PER_MINUTE {\n  origin "ADR.md" "Rate limiting" 1..1\n  type number\n  expected-value 100\n}\n`,
    );
    try {
      const res = await infer({ contractsDir: tmp, codeDir: CODE });
      const names = res.decisions.filter((d) => d.kind === 'NamedConstant').map((d) => d.identity);
      expect(names).not.toContain('RATE_LIMIT_PER_MINUTE');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('inference — provenance round-trip', () => {
  it('renders inferred-from + confidence that the resolver reads back as inferred', async () => {
    const res = await infer({ contractsDir: CONTRACTS, codeDir: CODE });
    const constant = res.decisions.find((d) => d.kind === 'NamedConstant');
    expect(constant).toBeDefined();
    const { tcSource } = renderDecision(constant!);

    const resolved = resolve([parseFile('inferred.tc', tcSource)]);
    expect(resolved.errors).toEqual([]);
    const artifact = [...resolved.index.values()][0];
    expect(artifact.provenance).toBe('inferred');
    expect(artifact.confidence).toBe(constant!.confidence);
    expect(artifact.origin?.source).toBe(constant!.codeLoc.path);
  });
});

describe('inference — writeInferred', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-infer-write-'));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes under _inferred/, is idempotent, and prunes stale files', async () => {
    const res = await infer({ contractsDir: CONTRACTS, codeDir: CODE });

    const first = writeInferred(tmp, res.decisions);
    expect(first.written.length).toBe(res.decisions.length);
    expect(first.written.every((p) => p.includes(`${path.sep}_inferred${path.sep}`))).toBe(true);

    // Re-running with identical input rewrites nothing.
    const second = writeInferred(tmp, res.decisions);
    expect(second.written).toEqual([]);

    // A stale file from a prior run is pruned when it's no longer inferred.
    const stale = path.join(tmp, '_inferred', '_shared', 'stale.tc');
    fs.writeFileSync(stale, 'architecture-decision x.y {\n}\n');
    expect(fs.existsSync(stale)).toBe(true);
    writeInferred(tmp, res.decisions);
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('dry run reports proposed files without writing', async () => {
    const res = await infer({ contractsDir: CONTRACTS, codeDir: CODE });
    const dry = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-infer-dry-'));
    try {
      const r = writeInferred(dry, res.decisions, { dryRun: true });
      expect(r.written).toEqual([]);
      expect(r.proposed.length).toBe(res.decisions.length);
      expect(fs.existsSync(path.join(dry, '_inferred'))).toBe(false);
    } finally {
      fs.rmSync(dry, { recursive: true, force: true });
    }
  });
});

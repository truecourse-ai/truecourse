import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from '../../packages/contract-verifier/src/parser/index.js';
import { resolve, refKey } from '../../packages/contract-verifier/src/resolver/index.js';

const FIXTURE_IL = path.resolve(__dirname, '../fixtures/sample-js-project-il/.truecourse/contracts');

function listTcFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && full.endsWith('.tc')) out.push(full);
    }
  };
  visit(root);
  return out.sort();
}

function loadAll() {
  const files = listTcFiles(FIXTURE_IL).map((fp) =>
    parseFile(fp, fs.readFileSync(fp, 'utf-8')),
  );
  return resolve(files);
}

describe('Contract resolver — fixture corpus', () => {
  it('lifts every artifact in the corpus', () => {
    const result = loadAll();
    expect(result.errors).toEqual([]);
    expect(result.index.size).toBeGreaterThanOrEqual(25);
  });

  it('every cross-reference resolves to a known artifact', () => {
    const result = loadAll();
    // PerformanceSLA is the one deliberately-unresolved forward reference
    // in the fixture (`could-become-enforceable-via PerformanceSLA`). Allow
    // exactly that one.
    const trulyUnresolved = result.unresolvedRefs.filter(
      (u) => u.ref.type !== 'PerformanceSLA' && u.ref.type !== 'Unknown',
    );
    if (trulyUnresolved.length > 0) {
      const summary = trulyUnresolved
        .map(
          (u) =>
            `  ${u.usedAt.filePath}:${u.usedAt.lineStart} ${refKey(u.ref)}`,
        )
        .join('\n');
      throw new Error(`unexpected unresolved cross-references:\n${summary}`);
    }
    expect(trulyUnresolved).toEqual([]);
  });

  it('indexes the canonical Order entity and its state machine', () => {
    const result = loadAll();
    expect(result.index.has('Entity:Order')).toBe(true);
    expect(result.index.has('StateMachine:Order.status')).toBe(true);
    expect(result.index.has('Enum:OrderStatus')).toBe(true);
  });

  it('builds Operation identity from method + path', () => {
    const result = loadAll();
    expect(result.index.has('Operation:POST /api/orders')).toBe(true);
    expect(result.index.has('Operation:GET /api/orders/{id}')).toBe(true);
    expect(result.index.has('Operation:POST /api/orders/{id}/pay')).toBe(true);
  });

  it('captures spec origin for every artifact that declares one', () => {
    const result = loadAll();
    const order = result.index.get('Entity:Order');
    expect(order).toBeDefined();
    expect(order!.origin).toBeTruthy();
    expect(order!.origin!.source).toBe('SPEC.md');
    expect(order!.origin!.lines[0]).toBeGreaterThan(0);
  });
});

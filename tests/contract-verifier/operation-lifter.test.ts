import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from '../../packages/contract-verifier/src/parser/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { OperationContract } from '../../packages/contract-verifier/src/types/index.js';

const FIXTURE_IL = path.resolve(__dirname, '../fixtures/sample-js-project-il/reference/contracts');

function loadAll() {
  const files: ReturnType<typeof parseFile>[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // `_inferred/` holds reverse-engineered contracts, not the authored
      // corpus these assertions cover — skip it.
      if (entry.isDirectory()) {
        if (entry.name === '_inferred') continue;
        visit(full);
      } else if (entry.isFile() && full.endsWith('.tc')) {
        files.push(parseFile(full, fs.readFileSync(full, 'utf-8')));
      }
    }
  };
  visit(FIXTURE_IL);
  return resolve(files);
}

describe('Contract Operation lifter', () => {
  it('lifts POST /api/orders into an OperationContract with response 201 + 400', () => {
    const r = loadAll();
    const op = r.index.get('Operation:POST /api/orders');
    expect(op).toBeDefined();
    expect(op!.contract).toBeDefined();
    const c = op!.contract as OperationContract;
    expect(c.method).toBe('POST');
    expect(c.path).toBe('/api/orders');
    expect(c.responses.map((r) => r.status).sort()).toEqual(['201', '400', '401']);
    const r201 = c.responses.find((r) => r.status === '201')!;
    expect(r201.condition?.kind).toBe('success');
    expect(r201.headers?.find((h) => h.name === 'location')?.required).toBe(true);
    expect(r201.effects?.some((e) => e.kind === 'emits' && e.ref.identity === 'order.placed')).toBe(true);
  });

  it('lifts inherited responses (response 401 inherits AuthRequirement:auth.bearer.api)', () => {
    const r = loadAll();
    const op = r.index.get('Operation:POST /api/orders')!;
    const c = op.contract as OperationContract;
    const r401 = c.responses.find((r) => r.status === '401')!;
    expect(r401.inheritedFrom).toBeDefined();
    expect(r401.inheritedFrom!.type).toBe('AuthRequirement');
    expect(r401.inheritedFrom!.identity).toBe('auth.bearer.api');
  });

  it('lifts forbid clauses on responses (GET /api/orders/{id} forbids 200 when resource-missing)', () => {
    const r = loadAll();
    const op = r.index.get('Operation:GET /api/orders/{id}')!;
    const c = op.contract as OperationContract;
    const r404 = c.responses.find((r) => r.status === '404')!;
    expect(r404.forbids).toBeDefined();
    expect(r404.forbids![0]).toEqual({ kind: 'status', value: 200, when: 'resource-missing' });
  });

  it('lifts tags', () => {
    const r = loadAll();
    const payOp = r.index.get('Operation:POST /api/orders/{id}/pay')!;
    const c = payOp.contract as OperationContract;
    expect(c.tags).toContain('transition');
    expect(c.tags).toContain('idempotent');
  });

  it('every Operation in the corpus has a lifted contract', () => {
    const r = loadAll();
    const ops = [...r.index.values()].filter((a) => a.ref.type === 'Operation');
    expect(ops.length).toBe(22);
    for (const op of ops) {
      expect(op.contract, `Operation:${op.ref.identity} missing contract`).toBeDefined();
    }
  });

  it('lifts a status-class response (`response 2xx`) — used when the spec is silent on a specific code', () => {
    // The lifter accepts 2xx/3xx/4xx/5xx as valid status tokens so the
    // LLM has a faithful way to express "the spec mentions a success
    // response but doesn't pin a specific code." Without this, the LLM
    // had to invent a literal status (typically 200), generating
    // false-positive drifts on creates that conventionally return
    // 201/204.
    const file = parseFile(
      'inline.tc',
      'operation POST "/api/things" {\n' +
        '  response 2xx on success {\n' +
        '    body Entity:Thing\n' +
        '  }\n' +
        '  tags []\n' +
        '}\n',
    );
    const result = resolve([file]);
    expect(result.errors).toEqual([]);
    const op = result.index.get('Operation:POST /api/things')!;
    const c = op.contract as OperationContract;
    expect(c.responses[0].status).toBe('2xx');
    expect(c.responses[0].condition?.kind).toBe('success');
  });
});

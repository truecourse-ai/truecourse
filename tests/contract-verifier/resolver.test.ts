import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseTcFile as parseFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve, refKey, canonicalizePathParams } from '../../packages/contract-verifier/src/resolver/index.js';

const FIXTURE_IL = path.resolve(__dirname, '../fixtures/sample-js-project-il/reference/contracts');

function listTcFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // `_inferred/` holds reverse-engineered contracts, not the authored
      // corpus these assertions cover — skip it.
      if (entry.isDirectory()) {
        if (entry.name === '_inferred') continue;
        visit(full);
      } else if (entry.isFile() && full.endsWith('.tc')) out.push(full);
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
    expect(order!.origin!.source).toMatch(/orders\/data\.md$/);
    expect(order!.origin!.lines[0]).toBeGreaterThan(0);
  });
});

describe('resolve — effective merge (base ∪ primary; repo wins by key)', () => {
  const op = (filePath: string, path: string, originSrc: string, extra = '') =>
    parseFile(filePath, `operation GET "${path}" {\n  origin "${originSrc}" "S" 1..2\n${extra}  tags []\n}\n`);

  it('unions disjoint keys (a repo inherits workspace-only contracts)', () => {
    const ws = op('ws/a.tc', '/api/ws-only', 'ws.md');
    const repo = op('repo/b.tc', '/api/repo-only', 'repo.md');
    const r = resolve([repo], { baseFiles: [ws] });
    expect(r.errors).toEqual([]);
    expect(r.index.has('Operation:GET /api/ws-only')).toBe(true); // inherited base
    expect(r.index.has('Operation:GET /api/repo-only')).toBe(true); // primary
  });

  it('repo wins on a ${kind}:${identity} collision — even from a differently-named file', () => {
    const ws = op('ws/shared.tc', '/api/orders', 'workspace.md');
    const repo = op('repo/custom.tc', '/api/orders', 'repo.md');
    const r = resolve([repo], { baseFiles: [ws] });
    expect(r.errors).toEqual([]); // an intentional override, NOT a duplicate error
    const winner = r.index.get('Operation:GET /api/orders')!;
    expect(winner.declarationLoc.filePath).toBe('repo/custom.tc'); // repo wins
    expect(winner.origin?.source).toBe('repo.md');
  });

  it('still flags a genuine duplicate WITHIN the primary layer', () => {
    const r = resolve([op('a.tc', '/api/x', 'a.md'), op('b.tc', '/api/x', 'b.md')]);
    expect(r.errors.some((e) => /duplicate artifact identity Operation:GET \/api\/x/.test(e.message))).toBe(true);
  });

  it('still flags a genuine duplicate WITHIN the base layer', () => {
    const r = resolve([], { baseFiles: [op('a.tc', '/api/x', 'a.md'), op('b.tc', '/api/x', 'b.md')] });
    expect(r.errors.some((e) => /duplicate artifact identity/.test(e.message))).toBe(true);
  });

  it('cross-references resolve across layers (a repo rule → a workspace operation)', () => {
    const wsOp = op('ws/op.tc', '/api/articles/{slug}', 'ws.md');
    const repoRule = parseFile(
      'repo/rule.tc',
      'authorization-rule article.owner-only {\n' +
        '  applies-to {\n' +
        '    operations [Operation:"GET /api/articles/{slug}"]\n' +
        '  }\n' +
        '  predicate "true"\n' +
        '}\n',
    );
    const r = resolve([repoRule], { baseFiles: [wsOp] });
    expect(r.unresolvedRefs.filter((u) => u.ref.type === 'Operation')).toEqual([]);
  });

  it('with no baseFiles, behaves exactly as the single-layer resolver', () => {
    const file = op('a.tc', '/api/x', 'a.md');
    expect(resolve([file], {})).toEqual(resolve([file]));
  });
});

describe('canonicalizePathParams', () => {
  it('converts Express colon-form params to RFC 6570 curly-brace form', () => {
    expect(canonicalizePathParams('/api/orders/:id')).toBe('/api/orders/{id}');
    expect(canonicalizePathParams('/users/:slug/posts/:postId')).toBe('/users/{slug}/posts/{postId}');
  });

  it('leaves an already-canonical path unchanged', () => {
    expect(canonicalizePathParams('/api/orders/{id}')).toBe('/api/orders/{id}');
    expect(canonicalizePathParams('/api/orders')).toBe('/api/orders');
  });

  it('only touches valid identifier chars after the colon', () => {
    // A colon followed by something that's not an identifier (e.g. a port,
    // protocol, or punctuation) should NOT be rewritten.
    expect(canonicalizePathParams('http://example.com:8080/foo')).toBe('http://example.com:8080/foo');
  });
});

describe('origin source paths', () => {
  it('accepts a quoted path with slashes as the origin source', () => {
    // Specs commonly live at `docs/API.md` rather than at the root.
    // The bare-ident form chokes on `/`; the quoted-string form must
    // work so the LLM can faithfully encode where the obligation came
    // from.
    const file = parseFile(
      'inline.tc',
      'operation GET "/api/x" {\n' +
        '  origin "docs/API.md" "Section" 5..20\n' +
        '  tags []\n' +
        '}\n',
    );
    const result = resolve([file]);
    expect(result.errors).toEqual([]);
    const op = result.index.get('Operation:GET /api/x')!;
    expect(op.origin?.source).toBe('docs/API.md');
    expect(op.origin?.section).toBe('Section');
    expect(op.origin?.lines).toEqual([5, 20]);
  });

  it('still accepts the bare-ident form (back-compat)', () => {
    const file = parseFile(
      'inline.tc',
      'operation GET "/api/x" {\n' +
        '  origin SPEC.md "Section" 1..10\n' +
        '  tags []\n' +
        '}\n',
    );
    const result = resolve([file]);
    expect(result.errors).toEqual([]);
    const op = result.index.get('Operation:GET /api/x')!;
    expect(op.origin?.source).toBe('SPEC.md');
  });
});

describe('Operation identity normalization', () => {
  it('indexes operations with `:slug` syntax under their RFC 6570 identity', () => {
    // The LLM (or a hand-written .tc) may use Express's `:slug` syntax in
    // an operation path. The resolver must canonicalize it so cross-refs
    // and code-side lookups land on the same identity.
    const file = parseFile(
      'in-memory.tc',
      'operation GET "/api/articles/:slug" { tags [] }\n',
    );
    const resolution = resolve([file]);
    expect(resolution.errors).toEqual([]);
    expect(resolution.index.has('Operation:GET /api/articles/{slug}')).toBe(true);
    expect(resolution.index.has('Operation:GET /api/articles/:slug')).toBe(false);
  });

  it('normalizes Operation cross-references with `:slug` syntax', () => {
    // A reference like `Operation:"GET /api/articles/:slug"` should
    // resolve to the same artifact as `Operation:"GET /api/articles/{slug}"`.
    const decl = parseFile(
      'decl.tc',
      'operation GET "/api/articles/{slug}" { tags [] }\n',
    );
    const consumer = parseFile(
      'consumer.tc',
      'authorization-rule article.owner-only {\n' +
        '  applies-to {\n' +
        '    operations [Operation:"GET /api/articles/:slug"]\n' +
        '  }\n' +
        '  predicate "true"\n' +
        '}\n',
    );
    const resolution = resolve([decl, consumer]);
    // The consumer's cross-ref must resolve — no entry in unresolvedRefs
    // for `Operation:GET /api/articles/:slug`.
    const unresolved = resolution.unresolvedRefs.filter((u) => u.ref.type === 'Operation');
    expect(unresolved).toEqual([]);
  });
});

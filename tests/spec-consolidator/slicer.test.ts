import { describe, it, expect } from 'vitest';
import { sliceDoc } from '../../packages/spec-consolidator/src/index.js';

/**
 * Slicer tests. Granularity rules:
 *
 *   - H1 with H2s → descend
 *   - H2 with multiple H3s → emit per H3
 *   - H2 with no H3s (or one H3) → one block for the H2 subtree
 *   - H3 (under multi-H3 H2) → its own block
 *
 * Plus fence-awareness, content-addressed ids, and line ranges that
 * downstream provenance depends on.
 */

describe('sliceDoc — granularity', () => {
  it('treats a flat H2-only doc as one block per H2', () => {
    const source = [
      '# Project',
      'Top-level prose.',
      '',
      '## Overview',
      'overview body',
      '',
      '## Authentication',
      'auth body',
    ].join('\n');
    const blocks = sliceDoc('SPEC.md', source);
    const headings = blocks.map((b) => b.headingPath);
    expect(headings).toEqual([
      ['Project', 'Overview'],
      ['Project', 'Authentication'],
    ]);
  });

  it('descends into H2 with multiple H3 children — one block per H3', () => {
    const source = [
      '# API',
      '',
      '## Endpoints',
      '',
      '### POST /orders',
      'create body',
      '',
      '### GET /orders',
      'list body',
      '',
      '### GET /orders/{id}',
      'detail body',
    ].join('\n');
    const blocks = sliceDoc('SPEC.md', source);
    const heads = blocks.map((b) => b.headingPath.at(-1));
    expect(heads).toEqual(['POST /orders', 'GET /orders', 'GET /orders/{id}']);
  });

  it('keeps an H2 with a single H3 as one block (single child = whole subtree)', () => {
    const source = [
      '# API',
      '',
      '## Authentication',
      'prose intro',
      '',
      '### Bearer token',
      'detail',
    ].join('\n');
    const blocks = sliceDoc('SPEC.md', source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].headingPath).toEqual(['API', 'Authentication']);
    expect(blocks[0].text).toContain('### Bearer token');
  });

  it('descends through H1 with H2 children (the H1 itself is never a block)', () => {
    const source = [
      '# Top',
      'top intro',
      '',
      '## A',
      'a body',
      '',
      '## B',
      'b body',
    ].join('\n');
    const blocks = sliceDoc('SPEC.md', source);
    const heads = blocks.map((b) => b.headingPath);
    expect(heads).toEqual([['Top', 'A'], ['Top', 'B']]);
  });

  it('emits a single block for a doc that has only one heading', () => {
    const source = '# Solo\nbody only.\n';
    const blocks = sliceDoc('SOLO.md', source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].headingPath).toEqual(['Solo']);
  });

  it('returns no blocks for a doc with no headings', () => {
    expect(sliceDoc('PROSE.md', 'Just some prose.\nNo headings.\n')).toEqual([]);
  });

  it('handles deeply nested H4+ children inside an H3 (whole subtree included)', () => {
    const source = [
      '## API',
      '',
      '### POST /orders',
      'create body',
      '',
      '#### Request',
      'shape',
      '',
      '#### Response',
      'shape',
    ].join('\n');
    const blocks = sliceDoc('s.md', source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('#### Request');
    expect(blocks[0].text).toContain('#### Response');
  });
});

describe('sliceDoc — fence-awareness', () => {
  it('does not treat `#` lines inside fenced code blocks as headings', () => {
    const source = [
      '## Real heading',
      '',
      '```bash',
      '# this is a comment, not a heading',
      'echo hi',
      '```',
      '',
      '## Another real heading',
    ].join('\n');
    const blocks = sliceDoc('s.md', source);
    const heads = blocks.map((b) => b.headingPath.at(-1));
    expect(heads).toEqual(['Real heading', 'Another real heading']);
  });

  it('handles ~~~ fences too', () => {
    const source = [
      '## A',
      '~~~',
      '## fake',
      '~~~',
      '',
      '## B',
    ].join('\n');
    const heads = sliceDoc('s.md', source).map((b) => b.headingPath.at(-1));
    expect(heads).toEqual(['A', 'B']);
  });
});

describe('sliceDoc — line ranges + ids', () => {
  it('emits 1-indexed start/end lines covering the heading and its body', () => {
    const source = [
      'preamble',     // 1
      '',             // 2
      '## A',         // 3
      'a body 1',     // 4
      'a body 2',     // 5
      '',             // 6
      '## B',         // 7
      'b body',       // 8
    ].join('\n');
    const blocks = sliceDoc('s.md', source);
    const a = blocks.find((b) => b.headingPath.at(-1) === 'A')!;
    const b = blocks.find((bl) => bl.headingPath.at(-1) === 'B')!;
    expect(a.startLine).toBe(3);
    expect(a.endLine).toBe(6);
    expect(b.startLine).toBe(7);
    expect(b.endLine).toBe(8);
  });

  it('produces a stable content-addressed id', () => {
    const source = '## Same\nsame body\n';
    const [a] = sliceDoc('a.md', source);
    const [b] = sliceDoc('a.md', source);
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('id changes when the file path changes (stays content-addressed by full key)', () => {
    const source = '## Same\nsame body\n';
    const [a] = sliceDoc('a.md', source);
    const [b] = sliceDoc('b.md', source);
    expect(a.id).not.toBe(b.id);
  });

  it('id changes when heading text changes', () => {
    const a = sliceDoc('s.md', '## A\nsame body\n')[0];
    const b = sliceDoc('s.md', '## B\nsame body\n')[0];
    expect(a.id).not.toBe(b.id);
  });

  it('id changes when body content changes', () => {
    const a = sliceDoc('s.md', '## A\nbody one\n')[0];
    const b = sliceDoc('s.md', '## A\nbody two\n')[0];
    expect(a.id).not.toBe(b.id);
  });
});

describe('sliceDoc — realistic shapes', () => {
  it('PRD-style doc: top H1 + H2 sections + an H2 with H3 endpoints', () => {
    const source = [
      '# Backend PRD v2',
      'Product description.',
      '',
      '## Overview',
      'context',
      '',
      '## Stack',
      'TS, Express, Knex',
      '',
      '## API Endpoints',
      '',
      '### GET /health',
      'open route',
      '',
      '### POST /api/v1/orders',
      'create order',
      '',
      '### GET /api/v1/orders/:id',
      'fetch order',
      '',
      '## Out of Scope',
      '- something',
    ].join('\n');
    const heads = sliceDoc('PRD.md', source).map((b) => b.headingPath);
    expect(heads).toEqual([
      ['Backend PRD v2', 'Overview'],
      ['Backend PRD v2', 'Stack'],
      ['Backend PRD v2', 'API Endpoints', 'GET /health'],
      ['Backend PRD v2', 'API Endpoints', 'POST /api/v1/orders'],
      ['Backend PRD v2', 'API Endpoints', 'GET /api/v1/orders/:id'],
      ['Backend PRD v2', 'Out of Scope'],
    ]);
  });
});

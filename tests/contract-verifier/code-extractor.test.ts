import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { extractOperationsFromFile } from '../../packages/contract-verifier/src/extractor/operation.js';

/**
 * Layer-2 tests: source code → ExtractedOperation. Each test feeds a small
 * synthesized TS source (no fixture) so we can pin behavior at the unit
 * level without depending on the fixture's full controller.
 */

describe('code → contract extractor (Operation)', () => {
  beforeAll(async () => {
    await initParsers();
  });

  function extract(source: string) {
    const tree = parseFile('memory.ts', source, 'typescript');
    return extractOperationsFromFile('memory.ts', source, tree);
  }

  it('captures method, path, and a single status from a minimal handler', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.post('/orders', (req, res) => {
        res.status(201).json({ id: 'x' });
      });
    `;
    const ops = extract(source);
    expect(ops).toHaveLength(1);
    expect(ops[0].identity).toBe('POST /orders');
    expect(ops[0].contract.method).toBe('POST');
    expect(ops[0].contract.path).toBe('/orders');
    const statuses = ops[0].contract.responses.map((r) => r.status).sort();
    expect(statuses).toContain('201');
  });

  it('records every distinct status emitted in branching handlers', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.get('/orders/:id', (req, res) => {
        if (!req.params.id) return res.status(400).json({});
        const order = null;
        if (!order) return res.status(404).json({});
        return res.status(200).json(order);
      });
    `;
    const ops = extract(source);
    const statuses = new Set(ops[0].contract.responses.map((r) => r.status));
    expect(statuses.has('200')).toBe(true);
    expect(statuses.has('400')).toBe(true);
    expect(statuses.has('404')).toBe(true);
  });

  it('captures res.setHeader entries on the same response', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.post('/orders', (req, res) => {
        res.setHeader('Location', '/orders/x');
        res.status(201).json({ id: 'x' });
      });
    `;
    const ops = extract(source);
    const r201 = ops[0].contract.responses.find((r) => r.status === '201');
    expect(r201?.headers?.some((h) => h.name.toLowerCase() === 'location')).toBe(true);
  });

  it('reads query-param names off req.query.<name> for cross-cutting comparators', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.get('/orders', (req, res) => {
        const cursor = req.query.cursor;
        const limit = req.query.limit;
        const status = req.query.status;
        res.status(200).json({});
      });
    `;
    const ops = extract(source);
    expect(ops[0].observed.queryParams.sort()).toEqual(['cursor', 'limit', 'status']);
  });

  it('records numeric clamp targets from Math.min calls', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.get('/orders', (req, res) => {
        const limit = Math.min(Number(req.query.limit) || 20, 50);
        res.status(200).json({ limit });
      });
    `;
    const ops = extract(source);
    expect(ops[0].observed.hasClampCall).toBe(true);
    expect(ops[0].observed.numericClamps).toContain(50);
  });

  it('follows single-file delegation: route → helper(...) → real responses', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      function transitionEndpoint(req, res, target) {
        if (!req.params.id) return res.status(404).json({});
        return res.status(200).json({ status: target });
      }
      router.post('/orders/:id/pay', (req, res, next) =>
        transitionEndpoint(req, res, 'paid'),
      );
    `;
    const ops = extract(source);
    expect(ops).toHaveLength(1);
    const statuses = new Set(ops[0].contract.responses.map((r) => r.status));
    expect(statuses.has('200')).toBe(true);
    expect(statuses.has('404')).toBe(true);
  });

  it('skips routes whose path is not a string literal (computed routes)', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      const path = '/dynamic';
      router.get(path, (req, res) => res.status(200).json({}));
    `;
    const ops = extract(source);
    expect(ops).toEqual([]);
  });

  it('emits one ExtractedOperation per route, with declarationLine pinned', () => {
    const source = [
      `import express from 'express';`,
      `const router = express.Router();`,
      ``,
      ``,
      `router.get('/a', (req, res) => res.status(200).json({}));`,
      `router.post('/b', (req, res) => res.status(201).json({}));`,
    ].join('\n');
    const ops = extract(source);
    expect(ops.map((o) => o.identity)).toEqual(['GET /a', 'POST /b']);
    expect(ops[0].declarationLine).toBe(5);
    expect(ops[1].declarationLine).toBe(6);
  });
});

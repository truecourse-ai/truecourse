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

  it('treats a bare res.json(...) as implicit 200 (Express default)', () => {
    // Modern Express handlers commonly omit res.status(200) before
    // res.json(...) since Express defaults to 200. Without recognizing
    // this, every such handler would appear to emit no responses at all.
    const source = `
      import express from 'express';
      const router = express.Router();
      router.get('/articles', (req, res) => {
        res.json({ articles: [] });
      });
    `;
    const ops = extract(source);
    const statuses = ops[0].contract.responses.map((r) => r.status);
    expect(statuses).toContain('200');
  });

  it('treats bare res.send / res.end as implicit 200 too', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.get('/healthz', (req, res) => {
        res.send('OK');
      });
      router.get('/empty', (req, res) => {
        res.end();
      });
    `;
    const ops = extract(source);
    expect(ops[0].contract.responses.some((r) => r.status === '200')).toBe(true);
    expect(ops[1].contract.responses.some((r) => r.status === '200')).toBe(true);
  });

  it('honours an explicit res.status(N) chain over the implicit-200 default', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.post('/orders', (req, res) => {
        res.status(201).json({ id: 'x' });
      });
    `;
    const ops = extract(source);
    const statuses = ops[0].contract.responses.map((r) => r.status);
    expect(statuses).toContain('201');
    // The chained .status(201) takes precedence — no spurious 200 from the
    // .json(...) call (the chain walker resolves it before the implicit
    // path triggers).
    expect(statuses).not.toContain('200');
  });

  it('treats res.sendStatus(N) as an explicit numeric status', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.delete('/orders/:id', (req, res) => {
        res.sendStatus(204);
      });
    `;
    const ops = extract(source);
    const statuses = ops[0].contract.responses.map((r) => r.status);
    expect(statuses).toContain('204');
    expect(statuses).not.toContain('200');
  });

  it('captures ES6 shorthand keys in res.json({ x }) as body fields', () => {
    // `res.json({ tags })` is sugar for `res.json({ tags: tags })`. The
    // extractor must surface `tags` as a body field — otherwise every
    // realworld-style controller using shorthand would produce
    // false-positive "missing key" drifts at the comparator.
    const source = `
      import express from 'express';
      const router = express.Router();
      router.get('/tags', (req, res) => {
        const tags = [];
        res.json({ tags });
      });
    `;
    const ops = extract(source);
    const r200 = ops[0].contract.responses.find((r) => r.status === '200')!;
    expect(r200.body?.fields).toBeDefined();
    expect(Object.keys(r200.body!.fields!)).toContain('tags');
  });

  it('mixes shorthand and explicit keys cleanly', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.get('/list', (req, res) => {
        const items = [];
        const nextCursor = null;
        res.json({ items, nextCursor, total: 0 });
      });
    `;
    const ops = extract(source);
    const r200 = ops[0].contract.responses.find((r) => r.status === '200')!;
    const keys = Object.keys(r200.body!.fields!);
    expect(keys).toContain('items');
    expect(keys).toContain('nextCursor');
    expect(keys).toContain('total');
  });

  it('recognizes new Response(...) — Web API / Astro / SvelteKit pattern', () => {
    // `return new Response(body, { status: 200 })` — the Fetch API
    // shape used by Astro endpoints, SvelteKit +server.ts files,
    // Cloudflare Workers, and Bun. Without recognition the handler
    // would appear to emit no responses at all.
    const source = `
      import express from 'express';
      const router = express.Router();
      router.get('/things', (req, res) => {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      });
    `;
    const ops = extract(source);
    const statuses = ops[0].contract.responses.map((r) => r.status);
    expect(statuses).toContain('200');
  });

  it('extracts a non-default status from new Response(body, { status: 201 })', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.post('/things', (req, res) => {
        return new Response(JSON.stringify({ id: 'x' }), { status: 201 });
      });
    `;
    const ops = extract(source);
    expect(ops[0].contract.responses.map((r) => r.status)).toContain('201');
  });

  it('treats new Response() with no init as implicit 200', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.get('/healthz', (req, res) => {
        return new Response('ok');
      });
    `;
    const ops = extract(source);
    expect(ops[0].contract.responses.map((r) => r.status)).toContain('200');
  });

  it('recognizes Response.json(body, init) — Next.js / modern Web API', () => {
    const source = `
      import express from 'express';
      const router = express.Router();
      router.get('/list', (req, res) => {
        return Response.json({ items: [] }, { status: 200 });
      });
    `;
    const ops = extract(source);
    expect(ops[0].contract.responses.map((r) => r.status)).toContain('200');
  });

  it('recognizes NextResponse.json(body, init)', () => {
    const source = `
      import { NextResponse } from 'next/server';
      const router = expressRouter();
      router.post('/items', (req, res) => {
        return NextResponse.json({ ok: true }, { status: 201 });
      });
    `;
    const ops = extract(source);
    expect(ops[0].contract.responses.map((r) => r.status)).toContain('201');
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectIdempotencyPresence,
  routeKey,
} from '../../packages/contract-verifier/src/extractor/idempotency-presence.js';

/**
 * Layer-2 test for the idempotency-key presence detector. Builds tiny
 * multi-file projects and asserts which routes end up in
 * `protectedRoutes`. Routes are keyed by `${filePath}::${declarationLine}`
 * to dodge mount-prefix and Express `:id` ↔ `{id}` normalization.
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-idem-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function place(rel: string, body: string): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
}

describe('idempotency presence detector', () => {
  it('marks a route as protected when an imported middleware reads the configured header', async () => {
    const orders = place(
      'src/orders.ts',
      `
        import express from 'express';
        import { idempotency } from './idempotency.middleware.js';
        const router = express.Router();
        router.post('/orders', idempotency, (req, res) => res.status(201).json({}));
      `,
    );
    place(
      'src/idempotency.middleware.ts',
      `
        export function idempotency(req, res, next) {
          const key = req.headers['idempotency-key'];
          if (!key) return next();
          next();
        }
      `,
    );

    const result = await detectIdempotencyPresence(root, 'Idempotency-Key');
    // The router.post is on the line right after Router() — index inside
    // the file. Use the helper to build the expected key.
    const lineOfPost =
      fs.readFileSync(orders, 'utf-8').split('\n').findIndex((l) => l.includes("router.post('/orders'")) + 1;
    expect(result.protectedRoutes.has(routeKey(orders, lineOfPost))).toBe(true);
  });

  it('leaves a route unprotected when no middleware reads the header', async () => {
    const orders = place(
      'src/orders.ts',
      `
        import express from 'express';
        const router = express.Router();
        router.post('/orders', (req, res) => res.status(201).json({}));
      `,
    );

    const result = await detectIdempotencyPresence(root, 'Idempotency-Key');
    const lineOfPost =
      fs.readFileSync(orders, 'utf-8').split('\n').findIndex((l) => l.includes("router.post('/orders'")) + 1;
    expect(result.protectedRoutes.has(routeKey(orders, lineOfPost))).toBe(false);
  });

  it('marks a route as protected when the inline handler reads the header itself', async () => {
    // The detector doesn't require a separate middleware — an inline
    // handler that reads the configured header is sufficient.
    const orders = place(
      'src/orders.ts',
      `
        import express from 'express';
        const router = express.Router();
        router.post('/orders', (req, res) => {
          const key = req.headers['idempotency-key'];
          if (key) { /* dedupe... */ }
          res.status(201).json({});
        });
      `,
    );

    const result = await detectIdempotencyPresence(root, 'Idempotency-Key');
    const lineOfPost =
      fs.readFileSync(orders, 'utf-8').split('\n').findIndex((l) => l.includes("router.post('/orders'")) + 1;
    expect(result.protectedRoutes.has(routeKey(orders, lineOfPost))).toBe(true);
  });

  it('matches the configured header case-insensitively', async () => {
    // Spec says `Idempotency-Key`; Express lowercases incoming headers, so
    // code reading `req.headers['idempotency-key']` should still satisfy.
    const orders = place(
      'src/orders.ts',
      `
        import express from 'express';
        const router = express.Router();
        router.post('/orders', (req, res) => {
          const key = req.headers['IDEMPOTENCY-KEY'];
          res.status(201).json({});
        });
      `,
    );

    const result = await detectIdempotencyPresence(root, 'Idempotency-Key');
    const lineOfPost =
      fs.readFileSync(orders, 'utf-8').split('\n').findIndex((l) => l.includes("router.post('/orders'")) + 1;
    expect(result.protectedRoutes.has(routeKey(orders, lineOfPost))).toBe(true);
  });

  it('recognises req.get() / req.header() as alternate read forms', async () => {
    const orders = place(
      'src/orders.ts',
      `
        import express from 'express';
        const router = express.Router();
        router.post('/orders', (req, res) => {
          const key = req.get('Idempotency-Key');
          res.status(201).json({});
        });
      `,
    );
    const result = await detectIdempotencyPresence(root, 'Idempotency-Key');
    const lineOfPost =
      fs.readFileSync(orders, 'utf-8').split('\n').findIndex((l) => l.includes("router.post('/orders'")) + 1;
    expect(result.protectedRoutes.has(routeKey(orders, lineOfPost))).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectAuthPresence } from '../../packages/contract-verifier/src/extractor/auth-presence.js';

/**
 * Layer-2 test for the cross-file auth-middleware presence detector.
 * Each test sets up a tiny multi-file repo, runs the detector, and
 * asserts which files end up in `protectedFiles`.
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-auth-'));
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

describe('auth presence detector', () => {
  it('marks a router file as protected when its router uses requireBearer', async () => {
    place(
      'src/orders.ts',
      `
        import express from 'express';
        import { requireBearer } from './auth.js';
        const router = express.Router();
        router.use(requireBearer);
        router.get('/orders', (req, res) => res.status(200).json({}));
        export default router;
      `,
    );
    place('src/auth.ts', `export function requireBearer(req, res, next) { next(); }`);

    const result = await detectAuthPresence(root);
    expect([...result.protectedFiles].some((p) => p.endsWith('orders.ts'))).toBe(true);
  });

  it('propagates auth from a parent router that mounts a sub-router', async () => {
    // Pattern: app.ts mounts ordersRouter under requireBearer; ordersRouter
    // itself doesn't call requireBearer but should still inherit protection.
    place(
      'src/app.ts',
      `
        import express from 'express';
        import { requireBearer } from './auth.js';
        import ordersRouter from './orders.js';
        const app = express();
        app.use(requireBearer);
        app.use(ordersRouter);
      `,
    );
    place(
      'src/orders.ts',
      `
        import express from 'express';
        const router = express.Router();
        router.get('/orders', (req, res) => res.status(200).json({}));
        export default router;
      `,
    );
    place('src/auth.ts', `export function requireBearer(req, res, next) { next(); }`);

    const result = await detectAuthPresence(root);
    expect([...result.protectedFiles].some((p) => p.endsWith('orders.ts'))).toBe(true);
  });

  it('leaves a router file unprotected when no auth middleware is in its chain', async () => {
    place(
      'src/customers.ts',
      `
        import express from 'express';
        const router = express.Router();
        router.get('/customers', (req, res) => res.status(200).json({}));
        export default router;
      `,
    );

    const result = await detectAuthPresence(root);
    expect([...result.protectedFiles].some((p) => p.endsWith('customers.ts'))).toBe(false);
  });

  it('recognises common auth middleware names beyond requireBearer', async () => {
    // The detector is conservative — it accepts a curated set of names like
    // `requireAuth`, `authenticate`, `protect`, etc. This test pins one
    // alternative so accidental shrinking of the list shows up here.
    place(
      'src/api.ts',
      `
        import express from 'express';
        import { requireAuth } from './auth.js';
        const router = express.Router();
        router.use(requireAuth);
        router.get('/x', (req, res) => res.status(200).json({}));
        export default router;
      `,
    );
    place('src/auth.ts', `export function requireAuth(req, res, next) { next(); }`);

    const result = await detectAuthPresence(root);
    expect([...result.protectedFiles].some((p) => p.endsWith('api.ts'))).toBe(true);
  });
});

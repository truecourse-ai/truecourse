import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initParsers } from '../../packages/analyzer/src/index.js';
import { extractOperationsFromDir } from '../../packages/contract-verifier/src/extractor/index.js';

/**
 * End-to-end tests for cross-file mount-graph resolution. Each test
 * stages a tmp project mimicking a real Express layout, runs the
 * extractor over it, and asserts the resolved URLs.
 */

let root: string;

beforeAll(async () => {
  await initParsers();
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mount-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function place(rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

describe('mount-graph: single-file mounts', () => {
  it('joins app.use prefix with the sub-router relative path', async () => {
    place(
      'app.ts',
      `
        import express from 'express';
        const app = express();
        const router = express.Router();
        router.get('/', (req, res) => res.json({ ok: true }));
        app.use('/health', router);
      `,
    );
    const ops = await extractOperationsFromDir(root);
    const ids = ops.map((o) => o.identity);
    expect(ids).toContain('GET /health');
    expect(ids).not.toContain('GET /');
  });

  it('strips trailing slash when the route path is the bare slash', async () => {
    // The classic FP from Compliance: prefix `/health` + path `/`
    // must become `/health`, not `/health/`. Spec specs mostly omit
    // the trailing slash so the latter would never match.
    place(
      'app.ts',
      `
        import express from 'express';
        const app = express();
        const r = express.Router();
        r.get('/', (req, res) => res.json({ ok: true }));
        app.use('/health', r);
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /health');
    expect(ops.find((o) => o.identity === 'GET /health/')).toBeUndefined();
  });

  it('composes nested mounts: app.use(/api/v1, api) and api.use(/users, users)', async () => {
    place(
      'app.ts',
      `
        import express from 'express';
        const app = express();
        const api = express.Router();
        const users = express.Router();
        users.get('/:id', (req, res) => res.json({}));
        api.use('/users', users);
        app.use('/api/v1', api);
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /api/v1/users/:id');
  });

  it('does NOT emit routes with their bare relative path when the router is mounted', async () => {
    // Old behavior was cartesian: it emitted both "/health" AND "/".
    // Spec lifters don't hold the bare relative variant, so it's pure
    // noise — a route declared inside a mounted router should only
    // surface under its mount.
    place(
      'app.ts',
      `
        import express from 'express';
        const app = express();
        const r = express.Router();
        r.get('/things', (req, res) => res.json({}));
        app.use('/api', r);
      `,
    );
    const ops = await extractOperationsFromDir(root);
    const ids = ops.map((o) => o.identity);
    expect(ids).toContain('GET /api/things');
    expect(ids).not.toContain('GET /things');
  });

  it('keeps the relative path when no parent mounts the router', async () => {
    // Routers that nothing mounts are still legitimate — a partially-
    // wired feature, a test fixture, or a router that gets mounted at
    // runtime in code we don't yet trace. Don't drop their routes.
    place(
      'standalone.ts',
      `
        import express from 'express';
        const router = express.Router();
        router.get('/orphan', (req, res) => res.json({}));
        export { router };
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /orphan');
  });
});

describe('mount-graph: cross-file imports', () => {
  it('resolves a router imported from another file (named export)', async () => {
    // The Compliance pattern: app.ts mounts a router that's defined
    // in routes/health.ts.
    place(
      'src/app.ts',
      `
        import express from 'express';
        import { healthRouter } from './routes/health.js';
        const app = express();
        app.use('/health', healthRouter);
      `,
    );
    place(
      'src/routes/health.ts',
      `
        import { Router } from 'express';
        export const healthRouter = Router();
        healthRouter.get('/', (req, res) => res.json({ status: 'ok' }));
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /health');
  });

  it('resolves a default-exported router', async () => {
    place(
      'src/app.ts',
      `
        import express from 'express';
        import api from './routes/index.js';
        const app = express();
        app.use('/api/v1', api);
      `,
    );
    place(
      'src/routes/index.ts',
      `
        import { Router } from 'express';
        const api = Router();
        api.get('/things', (req, res) => res.json({}));
        export default api;
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /api/v1/things');
  });

  it('respects an `as` rename in a named import', async () => {
    place(
      'src/app.ts',
      `
        import express from 'express';
        import { router as articles } from './routes/articles.js';
        const app = express();
        app.use('/articles', articles);
      `,
    );
    place(
      'src/routes/articles.ts',
      `
        import { Router } from 'express';
        export const router = Router();
        router.get('/:slug', (req, res) => res.json({}));
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /articles/:slug');
  });

  it('resolves an aliased export (`export { x as y }`)', async () => {
    place(
      'src/app.ts',
      `
        import express from 'express';
        import { healthRouter } from './routes/health.js';
        const app = express();
        app.use('/health', healthRouter);
      `,
    );
    place(
      'src/routes/health.ts',
      `
        import { Router } from 'express';
        const internal = Router();
        internal.get('/', (req, res) => res.json({}));
        export { internal as healthRouter };
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /health');
  });

  it('handles three-hop chains: app → composite → leaf router', async () => {
    place(
      'src/app.ts',
      `
        import express from 'express';
        import api from './api/index.js';
        const app = express();
        app.use('/api', api);
      `,
    );
    place(
      'src/api/index.ts',
      `
        import { Router } from 'express';
        import { usersRouter } from './users.js';
        const api = Router();
        api.use('/v1', usersRouter);
        export default api;
      `,
    );
    place(
      'src/api/users.ts',
      `
        import { Router } from 'express';
        export const usersRouter = Router();
        usersRouter.get('/me', (req, res) => res.json({}));
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /api/v1/me');
  });

  it('emits one URL per mount when the same router is mounted under two prefixes', async () => {
    // Rare but legal — a router mounted at multiple URLs. Each mount
    // should appear in the extracted op list.
    place(
      'app.ts',
      `
        import express from 'express';
        const app = express();
        const r = express.Router();
        r.get('/things', (req, res) => res.json({}));
        app.use('/v1', r);
        app.use('/v2', r);
      `,
    );
    const ops = await extractOperationsFromDir(root);
    const ids = ops.map((o) => o.identity);
    expect(ids).toContain('GET /v1/things');
    expect(ids).toContain('GET /v2/things');
  });

  it('treats `<parent>.use(<router>)` (no prefix) as a root-mount', async () => {
    // The fixture pattern: app.ts mounts a top-level routes module
    // with no prefix, and the routes module then sub-mounts under
    // /api. Without recognizing the no-prefix form the chain breaks
    // and every leaf surfaces with its bare relative path.
    place(
      'src/app.ts',
      `
        import express from 'express';
        import routes from './routes.js';
        const app = express();
        app.use(routes);
      `,
    );
    place(
      'src/routes.ts',
      `
        import { Router } from 'express';
        import { ordersRouter } from './orders.js';
        const root = Router();
        root.use('/api', ordersRouter);
        export default root;
      `,
    );
    place(
      'src/orders.ts',
      `
        import { Router } from 'express';
        export const ordersRouter = Router();
        ordersRouter.post('/orders', (req, res) => res.status(201).json({}));
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('POST /api/orders');
  });

  it('skips middleware identifiers in mixed `use(prefix, mw, router)` calls', async () => {
    // Express accepts middleware + sub-router in the same `use()` call:
    //   app.use('/api', requireAuth, ordersRouter)
    // The graph must still resolve the URL to /api/...; it can't
    // attribute the prefix to `requireAuth` (which isn't a router).
    place(
      'src/app.ts',
      `
        import express from 'express';
        import { ordersRouter } from './orders.js';
        import { requireAuth } from './auth.js';
        const app = express();
        app.use('/api', requireAuth, ordersRouter);
      `,
    );
    place(
      'src/orders.ts',
      `
        import { Router } from 'express';
        export const ordersRouter = Router();
        ordersRouter.get('/orders', (req, res) => res.json([]));
      `,
    );
    place(
      'src/auth.ts',
      `export function requireAuth(req, res, next) { next(); }`,
    );
    const ops = await extractOperationsFromDir(root);
    const ids = ops.map((o) => o.identity);
    expect(ids).toContain('GET /api/orders');
    // requireAuth isn't a router, so no phantom mount was attributed
    // to it. The route must NOT appear with a "GET /orders" variant.
    expect(ids).not.toContain('GET /orders');
  });

  it('ignores `app.use(express.json())` and other call-expression args', async () => {
    place(
      'src/app.ts',
      `
        import express from 'express';
        import { ordersRouter } from './orders.js';
        const app = express();
        app.use(express.json());
        app.use('/api', ordersRouter);
      `,
    );
    place(
      'src/orders.ts',
      `
        import { Router } from 'express';
        export const ordersRouter = Router();
        ordersRouter.get('/things', (req, res) => res.json([]));
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /api/things');
  });

  it('does not crash on a mount whose child resolves to nothing', async () => {
    // External / bare-import routers (e.g. a third-party package
    // exporting a router) can appear as children we can't pin down.
    // The graph builder must skip them silently.
    place(
      'app.ts',
      `
        import express from 'express';
        import externalRouter from 'some-third-party';
        const app = express();
        app.use('/ext', externalRouter);
        const local = express.Router();
        local.get('/', (req, res) => res.json({}));
        app.use('/health', local);
      `,
    );
    const ops = await extractOperationsFromDir(root);
    expect(ops.map((o) => o.identity)).toContain('GET /health');
  });
});

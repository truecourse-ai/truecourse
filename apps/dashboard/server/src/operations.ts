import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { RequestHandler, Response } from 'express';

export interface JobStats {
  queued: number;
  running: number;
  failedLast15Minutes: number;
  oldestActiveAgeSeconds: number;
}

export interface OperationsOptions {
  stats(): Promise<JobStats>;
  workerRunning(): boolean;
  localJobs(): { count: number; version: number };
  startDrained?: boolean;
  release?: string;
  healthTimeoutMs?: number;
}

export interface OperationsHealth {
  healthy: boolean;
  status: 'unhealthy' | 'drained' | 'draining' | 'ok';
  database: 'ok' | 'unreachable';
  workerRunning: boolean;
  draining: boolean;
  drained: boolean;
  activeRequests: number;
  localJobs: number;
  queued: number | null;
  running: number | null;
  failedLast15Minutes: number | null;
  oldestActiveAgeSeconds: number | null;
  release: string | null;
}

export interface Operations {
  admission: RequestHandler;
  health(): Promise<OperationsHealth>;
  drain(): void;
  resume(): void;
}

/** Process-local admission control. It does not stop the worker or cancel work. */
export function createOperations(opts: OperationsOptions): Operations {
  let draining = opts.startDrained ?? false;
  let activeRequests = 0;
  let activityVersion = 0;
  let pendingStats: Promise<JobStats> | undefined;

  const hold = () => {
    activeRequests += 1;
    activityVersion += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeRequests -= 1;
      activityVersion += 1;
    };
  };

  const admission: RequestHandler = (req, res, next) => {
    // Health and the read-only SSE subscription must remain available while
    // existing jobs finish. Everything else, including GET auth/setup callbacks,
    // is paused because a GET can also mutate application state.
    if ((req.method === 'GET' || req.method === 'HEAD') &&
      /^\/(health|events)\/?$/.test(req.path)) {
      next();
      return;
    }
    if (draining) {
      res.setHeader('Retry-After', '60');
      res.status(503).json({ error: 'Maintenance in progress. Try again shortly.' });
      return;
    }
    const release = hold();
    res.locals.holdOperationalWork = hold;
    // Do not release on socket close: a disconnected client can still have a
    // handler writing data or enqueueing a job. end() also handles a handler
    // finishing after its client disconnected. A stuck handler blocks draining.
    const end = res.end;
    res.end = function (this: Response, ...args: Parameters<typeof end>) {
      const result = end.apply(this, args);
      release();
      return result;
    } as typeof end;
    next();
  };

  async function health(): Promise<OperationsHealth> {
    const requestVersion = activityVersion;
    const before = opts.localJobs();
    let stats: JobStats | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Share a stalled query across polling requests rather than exhausting
      // the pool when Postgres is unreachable.
      if (!pendingStats) {
        const query = Promise.resolve().then(opts.stats);
        pendingStats = query;
        void query.then(
          () => { if (pendingStats === query) pendingStats = undefined; },
          () => { if (pendingStats === query) pendingStats = undefined; },
        );
      }
      stats = await Promise.race([
        pendingStats,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('database health timeout')), opts.healthTimeoutMs ?? 5000);
        }),
      ]);
    } catch {
      // No connection strings or raw database errors are exposed in health.
    } finally {
      clearTimeout(timer);
    }
    const after = opts.localJobs();
    const workerRunning = opts.workerRunning();
    const healthy = Boolean(stats && workerRunning);
    // Any activity during the SQL snapshot requires another poll, even when
    // counts have returned to zero. This closes the terminal-row -> successor
    // enqueue race and the HTTP producer finishing during the database query.
    const stable = requestVersion === activityVersion && before.version === after.version;
    const localJobs = Math.max(before.count, after.count);
    const drained = Boolean(draining && healthy && stable && activeRequests === 0 && localJobs === 0 &&
      stats?.queued === 0 && stats.running === 0);
    return {
      healthy,
      status: !healthy ? 'unhealthy' : drained ? 'drained' : draining ? 'draining' : 'ok',
      database: stats ? 'ok' : 'unreachable',
      workerRunning,
      draining,
      drained,
      activeRequests,
      localJobs,
      queued: stats?.queued ?? null,
      running: stats?.running ?? null,
      failedLast15Minutes: stats?.failedLast15Minutes ?? null,
      oldestActiveAgeSeconds: stats?.oldestActiveAgeSeconds ?? null,
      release: opts.release ?? null,
    };
  }

  return {
    admission,
    health,
    drain() { draining = true; },
    resume() { draining = false; },
  };
}

/** A route that answers before its work finishes must retain an explicit lease. */
export function holdRequestWork(res: Response): () => void {
  return res.locals.holdOperationalWork?.() ?? (() => {});
}

/** Read configuration only when enabled; a missing/weak token fails boot. */
export function operationsConfig(env: NodeJS.ProcessEnv = process.env): { port: number; token: string } | null {
  if (!env.TRUECOURSE_OPS_PORT) return null;
  const port = Number(env.TRUECOURSE_OPS_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('TRUECOURSE_OPS_PORT must be an integer from 1 to 65535');
  }
  const token = readFileSync(env.TRUECOURSE_OPS_TOKEN_FILE ?? '/etc/truecourse/ops-token', 'utf8').trim();
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
    throw new Error('Operations token must contain at least 32 URL-safe alphanumeric characters');
  }
  return { port, token };
}

/** Deliberately separate from Express and Caddy's public application listener. */
export async function startOperationsServer(
  operations: Operations,
  config: { port: number; token: string },
): Promise<Server> {
  const expected = Buffer.from(`Bearer ${config.token}`);
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/drain') operations.drain();
    else if (req.method === 'POST' && req.url === '/resume') operations.resume();
    else if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    try {
      res.end(JSON.stringify(await operations.health()));
    } catch {
      res.writeHead(503).end(JSON.stringify({ healthy: false, error: 'Health unavailable' }));
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

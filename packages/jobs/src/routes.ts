/**
 * The HTTP surface of the job queue: the live SSE stream, job status, and the
 * durable notifications feed. Every route is workspace-scoped through the
 * injected `orgIdOf` — a caller with no workspace gets 401, never another
 * workspace's rows.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '@truecourse/shared';
import type { JobStore, NotificationStore } from '@truecourse/data-store';
import type { EventBackplane } from './events.js';

/** How a route learns which workspace the caller is acting in. */
export type OrgIdOf = (req: Request) => string | null;

/** The default: the workspace stamped on the request by the auth gate. */
export const orgIdFromUser: OrgIdOf = (req) =>
  (req as Request & { user?: AuthUser }).user?.organizationId ?? null;

export function createEventsRouter(hub: EventBackplane, orgIdOf: OrgIdOf): Router {
  const router = Router();
  router.get('/', (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) {
      res.status(401).json({ error: 'no workspace' });
      return;
    }
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy (nginx) buffering of the stream
    });
    res.flushHeaders?.();
    res.write(': connected\n\n');
    const unsubscribe = hub.subscribe(org, res);
    // Heartbeat keeps idle connections (and intermediary proxies) from closing.
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  return router;
}

export function createJobsRouter(jobStore: JobStore, orgIdOf: OrgIdOf): Router {
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const active = req.query.active === '1' || req.query.active === 'true';
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const jobs = active ? await jobStore.listActive(org, type) : await jobStore.listForOrg(org);
    res.json({ jobs });
  });
  router.get('/:id', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const job = await jobStore.get(String(req.params.id), org);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json(job);
  });
  return router;
}

const readSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().min(1)).min(1) }),
]);

export function createNotificationsRouter(
  notifications: NotificationStore,
  orgIdOf: OrgIdOf,
): Router {
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const [list, unreadCount] = await Promise.all([
      notifications.listForOrg(org),
      notifications.unreadCount(org),
    ]);
    res.json({ notifications: list, unreadCount });
  });
  router.get('/unread-count', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    res.json({ unreadCount: await notifications.unreadCount(org) });
  });
  router.post('/read', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = readSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    if ('all' in parsed.data) await notifications.markAllRead(org);
    else await notifications.markRead(org, parsed.data.ids);
    res.json({ unreadCount: await notifications.unreadCount(org) });
  });
  return router;
}

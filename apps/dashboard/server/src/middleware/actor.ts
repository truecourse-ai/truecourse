/**
 * Who a request is being served for, available to code the request did not hand
 * itself to.
 *
 * The gate resolves the session onto `req.user`, which is enough for a route.
 * It is not enough for the seams a route reaches THROUGH — the repository link
 * store is written by the connect route, by the local provider and by the
 * GitHub webhook, and what it reports about a write depends on whether a person
 * was behind it. Threading an actor down through the provider packages would
 * put the dashboard's session into contracts that have nothing to do with it,
 * so the actor rides the call stack instead.
 *
 * `AsyncLocalStorage` carries it across every await of the request, and code
 * reached from anywhere else — a webhook, a job, a boot hook — reads no actor
 * at all, which is the honest answer there.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

/** The signed-in person a request is being served for. */
export interface RequestActor {
  userId: string;
  workspaceOrgId: string;
}

const storage = new AsyncLocalStorage<RequestActor>();

/** The person on whose request this code is running, or null when nobody asked. */
export function currentActor(): RequestActor | null {
  return storage.getStore() ?? null;
}

/**
 * Run everything below this middleware inside the caller's identity. Mounted
 * under the gate, so a request that got this far has a session; one whose
 * session names no workspace carries no actor rather than half of one.
 */
export function actorContext(): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user?.id || !user.organizationId) {
      next();
      return;
    }
    storage.run({ userId: user.id, workspaceOrgId: user.organizationId }, next);
  };
}

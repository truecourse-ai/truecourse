/**
 * Settings › Connections, as routes:
 *
 *   GET    /api/connections                every tool, connected or not
 *   PUT    /api/connections/:provider      connect or re-save; an omitted token keeps the stored one
 *   POST   /api/connections/:provider/test the real read a sync makes, limit 1
 *   DELETE /api/connections/:provider      remove it, and pause what read through it
 *
 * The token never comes back: a view carries its last four characters and
 * nothing more. A failed Test answers the reason the driver gave, which is a
 * sentence for a person — never the token, the path, the JQL or raw JSON.
 *
 * Removing a connection does NOT remove the documents it brought in: the
 * sources that read through it are PAUSED, with a note saying which account
 * went, so connecting the account again is a Resume rather than an add.
 */

import { Router, type Request, type Response } from 'express';
import {
  CONTEXT_CONNECTION_PROVIDERS,
  CONTEXT_SOURCE_KIND_LABEL,
  isContextConnectionProvider,
  type AuthUser,
  type ContextConnectionProvider,
  type ContextConnectionView,
} from '@truecourse/shared';
import type { ServerFeatureContext } from '@truecourse/dashboard-server';
import { log } from '@truecourse/core/lib/logger';
import {
  listContextSources,
  updateContextSource,
} from '@truecourse/core/lib/context-store';
import { ConnectionStore, type AtlassianConnection } from './store.js';

/** What a route needs of the connection it is about to act on. */
export interface ConnectionsRouterDeps {
  store: ConnectionStore;
  /**
   * The credentials probe behind Test: the same read the sync's first page
   * makes, bounded to one row, so a passing Test means a sync will work.
   */
  probe(provider: ContextConnectionProvider, connection: AtlassianConnection): Promise<void>;
  /** Report one product action, and tell the workspace its Context moved. */
  context: Pick<ServerFeatureContext, 'capture' | 'contextChanged'>;
}

/** The workspace the caller is acting in, or null when the session names none. */
function orgOf(req: Request): string | null {
  return (req as Request & { user?: AuthUser }).user?.organizationId ?? null;
}

/** `:provider` off the path, or null when it is not a tool with a connection. */
function providerOf(req: Request): ContextConnectionProvider | null {
  const raw = String(req.params.provider ?? '');
  return isContextConnectionProvider(raw) ? raw : null;
}

export function createConnectionsRouter(deps: ConnectionsRouterDeps): Router {
  const router: Router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const org = orgOf(req);
    if (!org) return res.status(403).json({ error: 'This session has no workspace.' });
    const connections: ContextConnectionView[] = await Promise.all(
      CONTEXT_CONNECTION_PROVIDERS.map((provider) => deps.store.getView(org, provider)),
    );
    res.json({ connections });
  });

  router.put('/:provider', async (req: Request, res: Response) => {
    const org = orgOf(req);
    if (!org) return res.status(403).json({ error: 'This session has no workspace.' });
    const provider = providerOf(req);
    if (!provider) return res.status(404).json({ error: 'No such connection.' });

    const body = (req.body ?? {}) as { baseUrl?: unknown; accountEmail?: unknown; apiToken?: unknown };
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const accountEmail = typeof body.accountEmail === 'string' ? body.accountEmail.trim() : '';
    const apiToken = typeof body.apiToken === 'string' ? body.apiToken.trim() : '';
    if (!baseUrl || !accountEmail) {
      return res.status(400).json({ error: 'The site URL and the account email are required.' });
    }
    // A first connection must carry its token; a re-save may leave it blank to
    // keep the stored one, which is what the masked field means.
    const existing = await deps.store.getView(org, provider);
    if (!existing.connected && !apiToken) {
      return res.status(400).json({ error: 'An API token is required to connect.' });
    }
    try {
      await deps.store.save(org, provider, {
        baseUrl,
        accountEmail,
        ...(apiToken ? { apiToken } : {}),
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
    deps.context.capture('connection_saved', req, { provider });
    res.json({ connection: await deps.store.getView(org, provider) });
  });

  // The SAME read a sync makes, bounded to one document — a passing Test means
  // a sync will work. The submitted token is used when there is one, the stored
  // one when the field was left masked.
  router.post('/:provider/test', async (req: Request, res: Response) => {
    const org = orgOf(req);
    if (!org) return res.status(403).json({ error: 'This session has no workspace.' });
    const provider = providerOf(req);
    if (!provider) return res.status(404).json({ error: 'No such connection.' });

    const body = (req.body ?? {}) as { baseUrl?: unknown; accountEmail?: unknown; apiToken?: unknown };
    const stored = await deps.store.getConnection(org, provider);
    const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim()
      ? body.baseUrl.trim().replace(/\/+$/, '')
      : (stored?.baseUrl ?? '');
    const accountEmail = typeof body.accountEmail === 'string' && body.accountEmail.trim()
      ? body.accountEmail.trim()
      : (stored?.accountEmail ?? '');
    const apiToken = typeof body.apiToken === 'string' && body.apiToken.trim()
      ? body.apiToken.trim()
      : (stored?.apiToken ?? '');
    if (!baseUrl || !accountEmail || !apiToken) {
      return res.status(400).json({
        ok: false,
        error: 'Fill in the site URL, the account email and an API token first.',
      });
    }
    try {
      await deps.probe(provider, { baseUrl, accountEmail, apiToken });
      res.json({ ok: true });
    } catch (err) {
      // The driver's own words. Nothing else is added, and nothing is logged
      // that the message did not already say.
      log.warn(`[connections] ${provider} test failed for ${org}: ${(err as Error).message}`);
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  router.delete('/:provider', async (req: Request, res: Response) => {
    const org = orgOf(req);
    if (!org) return res.status(403).json({ error: 'This session has no workspace.' });
    const provider = providerOf(req);
    if (!provider) return res.status(404).json({ error: 'No such connection.' });

    await deps.store.remove(org, provider);
    const paused = await pauseSourcesOf(org, provider);
    deps.context.capture('connection_removed', req, { provider });
    if (paused.length > 0) await deps.context.contextChanged(org, { change: 'sources' });
    res.json({ connection: await deps.store.getView(org, provider), paused });
  });

  /**
   * Every source that read through this account, paused with the reason. The
   * documents stay: a connection removed by mistake is one Resume away from
   * syncing again, and nothing about the corpus changes meanwhile.
   */
  async function pauseSourcesOf(
    org: string,
    provider: ContextConnectionProvider,
  ): Promise<string[]> {
    const paused: string[] = [];
    for (const source of await listContextSources(org)) {
      if (source.kind !== provider || source.status === 'paused') continue;
      await updateContextSource(org, source.id, {
        status: 'paused',
        statusNote: `The ${CONTEXT_SOURCE_KIND_LABEL[provider]} connection this source reads through was removed.`,
      });
      paused.push(source.id);
    }
    return paused;
  }

  return router;
}

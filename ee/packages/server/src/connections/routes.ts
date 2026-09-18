/**
 * Settings › Connections, as routes:
 *
 *   GET    /api/connections                every account, connected or not, with the kinds it serves
 *   PUT    /api/connections/:provider      connect or re-save; an omitted token keeps the stored one
 *   POST   /api/connections/:provider/test one bounded read per product the account serves
 *   DELETE /api/connections/:provider      remove it, and pause what read through it
 *
 * A connection is the ACCOUNT: one Atlassian login reads both Jira and
 * Confluence, so there is one row and Test answers a verdict per product. It
 * answers 200 with those verdicts whenever it could make the reads at all — a
 * 400 is a request that named no site, account or token.
 *
 * The token never comes back: a view carries its last four characters and
 * nothing more. A product's refusal is the reason the driver gave, which is a
 * sentence for a person — never the token, the path, the JQL or raw JSON.
 *
 * Removing a connection does NOT remove the documents it brought in: every
 * source of every kind the account served is PAUSED, with a note saying which
 * account went, so connecting it again is a Resume rather than an add.
 */

import { Router, type Request, type Response } from 'express';
import {
  CONTEXT_CONNECTION_KINDS,
  CONTEXT_CONNECTION_LABEL,
  CONTEXT_CONNECTION_PROVIDERS,
  isContextConnectionProvider,
  type AuthUser,
  type ContextConnectionProductTest,
  type ContextConnectionProvider,
  type ContextConnectionTestResponse,
  type ContextConnectionView,
  type ContextSourceKind,
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
   * The credentials probe behind Test, per PRODUCT: one read bounded to a row
   * that proves the site, the account, the token and that product's access. A
   * connection names no project or space, so their keys are the source's Check
   * to prove.
   */
  probe(kind: ContextSourceKind, connection: AtlassianConnection): Promise<void>;
  /** Report one product action, and tell the workspace its Context moved. */
  context: Pick<ServerFeatureContext, 'capture' | 'contextChanged'>;
}

/** The workspace the caller is acting in, or null when the session names none. */
function orgOf(req: Request): string | null {
  return (req as Request & { user?: AuthUser }).user?.organizationId ?? null;
}

/** `:provider` off the path, or null when it is not an account with a connection. */
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

  // One bounded read per product the account serves. The submitted token is
  // used when there is one, the stored one when the field was left masked. A
  // product that refuses is reported in its own driver's words, and the account
  // is usable as long as one product answered.
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

    const kinds = CONTEXT_CONNECTION_KINDS[provider];
    const verdicts = await Promise.all(
      kinds.map(async (kind): Promise<[ContextSourceKind, ContextConnectionProductTest]> => {
        try {
          await deps.probe(kind, { baseUrl, accountEmail, apiToken });
          return [kind, { ok: true }];
        } catch (err) {
          // The driver's own words. Nothing else is added, and nothing is
          // logged that the message did not already say.
          log.warn(`[connections] ${kind} test failed for ${org}: ${(err as Error).message}`);
          return [kind, { ok: false, error: (err as Error).message }];
        }
      }),
    );
    const answer: ContextConnectionTestResponse = {
      ok: verdicts.some(([, verdict]) => verdict.ok),
      products: Object.fromEntries(verdicts),
    };
    res.json(answer);
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
   * Every source of every kind this account served, paused with the reason. The
   * documents stay: a connection removed by mistake is one Resume away from
   * syncing again, and nothing about the corpus changes meanwhile.
   */
  async function pauseSourcesOf(
    org: string,
    provider: ContextConnectionProvider,
  ): Promise<string[]> {
    const kinds = CONTEXT_CONNECTION_KINDS[provider];
    const paused: string[] = [];
    for (const source of await listContextSources(org)) {
      if (!kinds.includes(source.kind) || source.status === 'paused') continue;
      await updateContextSource(org, source.id, {
        status: 'paused',
        statusNote: `The ${CONTEXT_CONNECTION_LABEL[provider]} connection this source reads through was removed.`,
      });
      paused.push(source.id);
    }
    return paused;
  }

  return router;
}

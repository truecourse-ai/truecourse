/**
 * Settings → Integrations API (enterprise, protected). Connector-generic:
 * `GET /` lists every connector with its field metadata + current connection;
 * `POST /` saves one, `POST /test` checks credentials live, `DELETE /:kind`
 * disconnects. Adding a connector needs no route changes. Secret fields are
 * encrypted at rest and never returned to the client. The sync itself lives on
 * `/api/ee/knowledge/sync`.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthUser, EeServerRegistry } from '@truecourse/shared';
import type { EeDb } from '@truecourse/ee-db';
import { log } from '@truecourse/core/lib/logger';
import { captureEeException, upstreamStatusOf } from '../observability/sentry.js';
import { IntegrationStore } from './store.js';
import { CONNECTORS } from '../knowledge/connectors/registry.js';
import {
  connectorConfig,
  secretFieldKey,
  type ConnectorKind,
  type KnowledgeConnector,
} from '../knowledge/connectors/types.js';

function orgIdOf(req: Request): string | null {
  return (req as Request & { eeUser?: AuthUser }).eeUser?.organizationId ?? null;
}

const saveSchema = z.object({
  kind: z.string().min(1),
  values: z.record(z.string(), z.string()),
});

/** Split submitted form values into non-secret config + the secret token. */
function splitValues(
  connector: KnowledgeConnector,
  values: Record<string, string>,
): { config: Record<string, string>; token?: string } {
  const secret = secretFieldKey(connector);
  const config: Record<string, string> = {};
  let token: string | undefined;
  for (const f of connector.fields) {
    const v = values[f.key]?.trim();
    if (f.secret) {
      if (v) token = v;
    } else if (v) {
      config[f.key] = v;
    }
  }
  return { config, token };
}

function connectorFor(kind: string): KnowledgeConnector | undefined {
  return CONNECTORS[kind as ConnectorKind];
}

export function createIntegrationsRouter(db: EeDb, masterSecret: string): Router {
  const router = Router();
  const store = new IntegrationStore(db, masterSecret);

  // List every connector with its field metadata + current connection status.
  router.get('/', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const list = Object.values(CONNECTORS).filter((c): c is KnowledgeConnector => !!c);
    const connectors = await Promise.all(
      list.map(async (c) => ({
        kind: c.kind,
        name: c.name,
        description: c.description,
        fields: c.fields,
        connection: await store.getView(org, c.kind),
      })),
    );
    res.json({ connectors });
  });

  // Save (connect/update) a connector.
  router.post('/', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    const connector = connectorFor(parsed.data.kind);
    if (!connector) return res.status(400).json({ error: `Unknown connector: ${parsed.data.kind}` });

    const { config, token } = splitValues(connector, parsed.data.values);
    const secretField = connector.fields.find((f) => f.secret);
    const existing = await store.getView(org, connector.kind);
    if (secretField && !existing?.hasToken && !token) {
      return res.status(400).json({ error: `${secretField.label} is required to connect.` });
    }
    await store.save(org, connector.kind, { config, token });
    res.json({ connection: await store.getView(org, connector.kind) });
  });

  // Live credential check (the "Test" button). Uses the submitted token, or the
  // stored one when the field is left blank.
  router.post('/test', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
    const connector = connectorFor(parsed.data.kind);
    if (!connector) return res.status(400).json({ error: `Unknown connector: ${parsed.data.kind}` });

    const { config, token } = splitValues(connector, parsed.data.values);
    const effectiveToken = token ?? (await store.getConnection(org, connector.kind))?.token;
    try {
      await connector.test(connectorConfig(connector, config, effectiveToken));
      res.json({ ok: true });
    } catch (e) {
      const upstreamStatus = upstreamStatusOf(e);
      log.warn(
        `[ee-integrations] ${connector.kind} test failed (org ${org}${upstreamStatus ? `, ${upstreamStatus}` : ''}): ${(e as Error).message}`,
      );
      captureEeException(e, {
        component: 'integrations',
        orgId: org,
        connector: connector.kind,
        upstreamStatus,
        route: 'POST /api/ee/integrations/test',
        level: 'warning',
      });
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  router.delete('/:kind', async (req: Request, res: Response) => {
    const org = orgIdOf(req);
    if (!org) return res.status(401).json({ error: 'no workspace' });
    await store.delete(org, String(req.params.kind));
    res.json({ ok: true });
  });

  return router;
}

/** Mount the Integrations API. Protected by default (behind the enterprise gate). */
export function registerIntegrations(registry: EeServerRegistry, opts: { db: EeDb; masterSecret: string }): void {
  registry.registerRouter('/api/ee/integrations', createIntegrationsRouter(opts.db, opts.masterSecret));
}

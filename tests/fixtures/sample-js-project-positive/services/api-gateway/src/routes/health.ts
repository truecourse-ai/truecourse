import { Router } from 'express';
import { HealthService } from '../services/health.service';
import { authMiddleware } from '../middleware/auth';

export const healthRouter = Router();
const healthService = new HealthService();

healthRouter.get('/', authMiddleware, (_req, res) => {
  res.json(healthService.check());
});



// --- route-without-auth-middleware shape: public-api-documentation-endpoint ---
// Intentionally no auth — OpenAPI spec endpoints are public by design
declare function createApp(): { get: (path: string, handler: (req: Request) => Response) => void };
declare const openApiV1Spec: Record<string, unknown>;
declare const openApiV2Spec: Record<string, unknown>;

const docsApp = createApp();

// Public OpenAPI spec endpoints — no auth required (equivalent to Swagger UI)
docsApp.get('/api/v1/openapi.json', (_req: Request) => Response.json(openApiV1Spec));
docsApp.get('/api/v2/openapi.json', (_req: Request) => Response.json(openApiV2Spec));
docsApp.get('/health', (_req: Request) => Response.json({ status: 'ok', timestamp: Date.now() }));




// --- argument-type-mismatch shape: route handler with c.redirect(url) — Hono context redirect ---
declare const router_016d: {
  get: (path: string, handler: (c: { redirect: (url: string, status?: number) => Response }) => Response) => void
};

// Redirect route: c.redirect accepts a string URL — no argument type mismatch
router_016d.get('/openapi', (c) => c.redirect('/api/v1/openapi.json'));
router_016d.get('/docs', (c) => c.redirect('/api/v1/docs'));



// FP shape: error string literal in a single JSON 404 response (single-usage-false-trigger)
declare const ctx: {
  json: (body: unknown, status: number) => Response;
  req: { header: (name: string) => string | undefined };
};

async function getEnvelopeItemPdfRoute(): Promise<Response> {
  const authHeader = ctx.req.header('Authorization');

  if (!authHeader) {
    return ctx.json({ error: 'Not found' }, 404);
  }

  const item = await fetchEnvelopeItem(authHeader);
  return ctx.json(item, 200);
}

declare function fetchEnvelopeItem(token: string): Promise<unknown>;



// FP shape: status string literal in a single health endpoint's catch block (single-usage-false-trigger)
declare const db: { query: (sql: string) => Promise<void> };

type CheckStatus = 'ok' | 'error';

async function healthCheckHandler() {
  const checks: Record<string, { status: CheckStatus }> = {};
  let overallStatus: CheckStatus = 'ok';

  try {
    await db.query('SELECT 1');
  } catch {
    checks.database = { status: 'error' };
    overallStatus = 'error';
  }

  return { status: overallStatus, checks };
}



// HTTP 304 Not Modified is the standard cache response status code
declare const c: { status: (code: number) => Response };

export function handleCachedResponse(): Response {
  return c.status(304);
}

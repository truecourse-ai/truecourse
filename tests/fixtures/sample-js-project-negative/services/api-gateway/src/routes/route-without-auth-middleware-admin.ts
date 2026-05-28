/**
 * Negative fixture for architecture/deterministic/route-without-auth-middleware.
 *
 * A privileged admin endpoint registered with no authentication middleware in
 * its chain and no global auth hook applied to the app — anyone who knows the
 * URL can trigger it. This is the real missing-auth bug the rule exists to
 * catch.
 */
import 'hono';

interface Ctx {
  json: (body: unknown) => Response;
}

interface ApiRouter {
  post: (path: string, handler: (c: Ctx) => Promise<Response>) => void;
}

declare const app: ApiRouter;
declare const purgeAllAccounts: () => Promise<{ purged: number }>;

export function registerAdminRoutes(): void {
  // VIOLATION: architecture/deterministic/route-without-auth-middleware
  app.post('/api/admin/accounts/purge', async (c) => c.json(await purgeAllAccounts()));
}

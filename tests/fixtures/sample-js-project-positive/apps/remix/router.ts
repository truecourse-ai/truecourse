
// D02: Hono route registration with c.json — no type mismatch
declare const openApiSpec: Record<string, unknown>;

interface HonoContext {
  json(value: unknown): Response;
}

interface HonoApp {
  get(path: string, handler: (c: HonoContext) => Response): void;
}

declare const app: HonoApp;

export function registerApiRoutes(): void {
  app.get('/api/v1/openapi.json', (c) => c.json(openApiSpec));
}



// G20: standard route config adapter with callback — no type mismatch
declare function routeOptionAdapter(defineRoutes: (routes: (path: string, file: string) => void) => void): object;
declare function discoverRoutes(opts: { routeDir: string }): (defineRoutes: (path: string, file: string) => void) => void;

const routes = routeOptionAdapter((defineRoutes) =>
  discoverRoutes({ routeDir: 'app/routes' })(defineRoutes),
);



// --- void-zero-argument FP shape: module-toplevel-fire-and-forget (service startup) ---
// void ServiceClient.start() at module top-level is intentional fire-and-forget service startup
declare const AnalyticsClient: { start: () => Promise<void> };

void AnalyticsClient.start();



// --- no-void shape: module-level-or-non-react-async-init (void fn() at top-level module scope) ---
declare const AnalyticsClient_2d47: { start: () => Promise<void> };
declare const LicenseClient_2d47: { start: () => Promise<void> };
declare function migrateServiceAccounts_2d47(): Promise<void>;
declare function getEnv_2d47(key: string): string;

// Start analytics client for anonymous usage tracking.
if (getEnv_2d47('NODE_ENV') !== 'development') {
  void AnalyticsClient_2d47.start();
}

// Start license client to verify license on startup.
void LicenseClient_2d47.start();

void migrateServiceAccounts_2d47();



// FP: enum-field-type-dispatch — comparing match?.id against route name strings to determine active layout route
declare const currentMatches: Array<{ id: string; pathname: string }> | undefined;

const RECIPIENT_LAYOUT_ROUTE = '_recipient._layout';
const SIGNING_ROUTE = '_recipient._layout.sign';

function getActiveRecipientLayout() {
  const match = currentMatches?.find(
    (m) => m.id === RECIPIENT_LAYOUT_ROUTE || m.id === SIGNING_ROUTE,
  );
  return match?.id === SIGNING_ROUTE ? 'signing' : 'default';
}

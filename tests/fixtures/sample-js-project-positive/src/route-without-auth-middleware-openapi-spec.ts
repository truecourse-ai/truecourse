/**
 * Positive fixture for architecture/deterministic/route-without-auth-middleware.
 *
 * OpenAPI / Swagger spec endpoints serve the generated API schema document.
 * They are public documentation surfaces by convention — doc viewers and
 * client-SDK generators fetch the schema without credentials — so registering
 * them without an auth middleware is correct, not a missing-auth bug.
 */
import 'hono';

interface Ctx {
  json: (body: unknown) => Response;
}

interface ApiRouter {
  use: (path: string, middleware: (c: Ctx) => Response) => void;
  get: (path: string, handler: (c: Ctx) => Response) => void;
}

declare const app: ApiRouter;
declare const apiRateLimitMiddleware: (c: Ctx) => Response;
declare const apiSchemaDocument: unknown;

export function registerSpecRoutes(): void {
  // The API surface is rate-limited at the router level.
  app.use('/api/v2/*', apiRateLimitMiddleware);

  app.get('/api/v2/openapi.json', (c) => c.json(apiSchemaDocument));
  app.get('/api/v2-beta/openapi.json', (c) => c.json(apiSchemaDocument));
  app.get('/swagger.json', (c) => c.json(apiSchemaDocument));
}

// router.ts: the file IS the router — exports the configured Hono app instance.
import { Hono } from 'hono';
const app = new Hono();
app.get('/health', (c) => c.json({ status: 'ok' }));
export { app };



// instanceof-narrowed-before-access: catch(error) narrowed via instanceof AppError before re-throw; non-AppError throws new AppError without accessing properties
declare class AppError extends Error {
  code: string;
  constructor(code: string, message: string);
}
declare function createEmbeddingTemplate(data: Record<string, unknown>): Promise<{ id: string }>;

async function createTemplate(data: Record<string, unknown>): Promise<{ id: string }> {
  try {
    return await createEmbeddingTemplate(data);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('TEMPLATE_CREATE_FAILED', 'Failed to create embedding template');
  }
}



// safe-value-pass-no-property-access: catch(err) passed to AppError.toRestAPIError(err) as a value; not property-accessed
declare const AppError: { toRestAPIError(e: unknown): { status: number; body: Record<string, unknown> } };
declare function processApiRequest(route: string, data: unknown): Promise<unknown>;

async function handleApiRequest(route: string, data: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const result = await processApiRequest(route, data);
    return { status: 200, body: result };
  } catch (err) {
    const restError = AppError.toRestAPIError(err);
    return restError;
  }
}


// --- filename-class-mismatch FP: router.ts exports 'app' instance — common file-IS-router pattern ---
// router.ts is the router; the file exports the configured app object under a generic name.
// This is a standard pattern: the export name need not match the filename.
declare class HonoApp {
  get(path: string, handler: (c: any) => any): this;
  post(path: string, handler: (c: any) => any): this;
  use(middleware: (c: any, next: () => Promise<void>) => Promise<void>): this;
  route(path: string, subApp: HonoApp): this;
}
declare function Hono(): HonoApp;
declare const reportRoutes: HonoApp;
declare const contactRoutes: HonoApp;
declare function cors(opts: object): (c: any, next: () => Promise<void>) => Promise<void>;
declare function rateLimiter(opts: object): (c: any, next: () => Promise<void>) => Promise<void>;

const app2 = Hono();
app2.use(cors({ origin: '*' }));
app2.use(rateLimiter({ max: 100, windowMs: 60_000 }));
app2.route('/reports', reportRoutes);
app2.route('/contacts', contactRoutes);
app2.get('/healthz', (c: any) => c.json({ status: 'ok' }));

export { app2 as app };



// filename-class-mismatch: router.ts exports an uppercase default that doesn't match the filename
declare class HonoBase {
  get(path: string, handler: (c: any) => any): this;
  post(path: string, handler: (c: any) => any): this;
  route(path: string, subApp: HonoBase): this;
}
declare function createHono(): HonoBase;
declare const analyticsRoutes: HonoBase;
declare const reportRoutes: HonoBase;

class ApiGatewayApp {
  private readonly hono: HonoBase;
  constructor() {
    this.hono = createHono();
    this.hono.route('/analytics', analyticsRoutes);
    this.hono.route('/reports', reportRoutes);
    this.hono.get('/healthz', (c: any) => c.json({ ok: true }));
  }
  getHandler(): HonoBase { return this.hono; }
}

export default ApiGatewayApp;


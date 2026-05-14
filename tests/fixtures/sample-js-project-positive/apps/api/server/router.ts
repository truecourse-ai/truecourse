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

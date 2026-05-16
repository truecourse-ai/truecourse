
// Hono app.use() with async handler — Hono context param 'c', not Express (req, res, next)
interface HonoCtx { req: { header(name: string): string | undefined }; json(data: unknown): Response; }
interface HonoApp {
  use(path: string, handler: (c: HonoCtx, next: () => Promise<void>) => Promise<void | Response>): void;
  get(path: string, handler: (c: HonoCtx) => Promise<Response>): void;
}

declare const apiApp: HonoApp;
declare function resolveApiVersion(acceptHeader: string | undefined): string;
declare function loadApiVersionMiddlewareConfig(version: string): Promise<Record<string, unknown>>;

apiApp.use('/api/v*', async (c, next) => {
  const acceptHeader = c.req.header('Accept');
  const version = resolveApiVersion(acceptHeader);
  await loadApiVersionMiddlewareConfig(version);
  await next();
});


// Hono middleware registered with app.use() — single context param 'c', Hono convention
interface HonoCtx { req: { header(name: string): string | undefined }; json(data: unknown): Response; }
interface HonoApp {
  use(handler: (c: HonoCtx, next: () => Promise<void>) => Promise<void>): void;
}

declare const mainApp: HonoApp;
declare function extractAuthToken(header: string | undefined): string | null;
declare function validateToken(token: string): Promise<{ userId: string }>;

mainApp.use(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = extractAuthToken(authHeader);
  if (token) {
    await validateToken(token);
  }
  await next();
});

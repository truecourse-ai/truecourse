
// Hono app.fetch() — in-process routing dispatch, not an outbound network HTTP call
interface HonoApp { fetch(req: Request): Promise<Response>; }
interface HonoCtx { req: { raw: Request }; json(data: unknown): Response; }
interface HonoRouter { post(path: string, handler: (c: HonoCtx) => Promise<Response>): void; }

declare const dashboardApp: HonoApp;
declare const jobRouter: HonoRouter;

jobRouter.post('/jobs/trigger', async (c) => {
  // Dispatch to the dashboard Hono sub-app — in-process routing, no network socket opened
  const response = await dashboardApp.fetch(c.req.raw);
  const data = await response.json();
  return c.json({ dispatched: true, result: data });
});

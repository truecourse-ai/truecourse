
// Hono route with async handler — Hono handles async errors natively, no Express wrapper needed
interface HonoContext { req: { param(k: string): string; raw: Request }; json(data: unknown, status?: number): Response; }
interface HonoApp { get(path: string, handler: (c: HonoContext) => Promise<Response>): void; }

declare const honoApp: HonoApp;
declare function getDocumentPdfByToken(token: string): Promise<Uint8Array>;

honoApp.get('/api/documents/:token/pdf', async (c) => {
  const token = c.req.param('token');
  const pdfBytes = await getDocumentPdfByToken(token);
  return c.json({ data: Array.from(pdfBytes) });
});

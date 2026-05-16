
// Hono route with async handler using Hono context — not Express; async errors propagated natively
interface HonoCtx { req: { param(k: string): string }; json(data: unknown, status?: number): Response; }
interface HonoRouter { get(path: string, handler: (c: HonoCtx) => Promise<Response>): void; }

declare const documentRouter: HonoRouter;
declare function streamDocumentPdf(documentId: string): Promise<Uint8Array>;

documentRouter.get('/documents/:id/download', async (c) => {
  const documentId = c.req.param('id');
  const pdfBuffer = await streamDocumentPdf(documentId);
  return c.json({ size: pdfBuffer.byteLength });
});

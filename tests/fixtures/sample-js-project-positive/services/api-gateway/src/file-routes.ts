
// --- FP shape: Hono route builder .post() with validator middleware ---
declare const ZUploadFileSchema: unknown;
declare function sValidator(target: string, schema: unknown): unknown;
declare const app: {
  post(path: string, ...middlewares: unknown[]): unknown;
};

app.post(
  '/upload',
  sValidator('json', ZUploadFileSchema),
  async (c: { req: { valid(target: string): unknown }; json(data: unknown): unknown }) => {
    const body = c.req.valid('json');
    return c.json({ success: true, data: body });
  },
);

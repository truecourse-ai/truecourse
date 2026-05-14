declare const c: { json: (data: object, status?: number) => object; req: { valid: (t: string) => { envelopeId: string; envelopeItemId: string } }; get: (key: string) => { info: (obj: object) => void } };
declare function getOptionalSession(ctx: typeof c): Promise<{ user?: { id: string } }>;
declare const db: { envelope: { findFirst: (opts: object) => Promise<object | null> } };

export async function handleEnvelopeItemDownload() {
  const { envelopeId, envelopeItemId } = c.req.valid('param');
  const session = await getOptionalSession(c);

  if (!session.user) {
    // c.json() is synchronous — early-exit guard returning a plain value, not a Promise.
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const envelope = await db.envelope.findFirst({ where: { id: envelopeId } } as object);

  if (!envelope) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json({ envelope });
}

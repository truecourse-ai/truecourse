declare const c: { json: (data: object, status?: number) => object; req: { valid: (t: string) => { envelopeId: string } } };
declare function getOptionalSession(ctx: typeof c): Promise<{ user?: { id: string } }>;
declare const db: { envelope: { findFirst: (opts: object) => Promise<object | null> } };

export async function handleDocumentDownload() {
  const { envelopeId } = c.req.valid('param');

  try {
    const session = await getOptionalSession(c);

    if (!session.user) {
      // c.json() in Hono is synchronous and returns a Response directly, not a Promise.
      // These are early-return guards inside try blocks; no await needed.
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const envelope = await db.envelope.findFirst({ where: { id: envelopeId } } as object);

    if (!envelope) {
      return c.json({ error: 'Not found' }, 404);
    }

    return c.json({ envelope });
  } catch (err) {
    return c.json({ error: 'Internal server error' }, 500);
  }
}

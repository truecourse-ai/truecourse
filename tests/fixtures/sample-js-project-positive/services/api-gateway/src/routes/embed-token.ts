// Token-gated public-endpoint shape. Mirrors documenso
// apps/remix/server/api/files/routes/get-envelope-item-pdf-by-token.ts:23 —
// a recipient accesses a signed document via a URL-embedded token; the
// handler validates that token against the database inline (no session
// middleware needed because recipients don't have user sessions).
//
// The route-without-auth-middleware visitor only sees app.get('...', handler)
// with no auth-named middleware identifier in the argument list and no global
// app.use(authMiddleware) — it cannot inspect handler bodies for inline token
// validation, so this is the canonical FP shape.

import { Hono } from 'hono';

declare const findRecipientByToken: (token: string) => Promise<{ id: string; envelopeId: string } | null>;
declare const verifyEmbeddingPresignToken: (token: string) => Promise<boolean>;
declare const loadEnvelopeFileBytes: (envelopeId: string) => Promise<Uint8Array>;

type HonoContext = {
  req: { param: (name: string) => string };
  body: (data: Uint8Array | string, status?: number) => Response;
  json: (data: unknown, status?: number) => Response;
};

const app = new Hono();

app.get('/api/files/envelope/:envelopeId/pdf/by-token/:token', async (c: HonoContext) => {
  const token = c.req.param('token');
  const recipient = await findRecipientByToken(token);
  if (!recipient) {
    return c.json({ message: 'Not found' }, 404);
  }
  const presignOk = await verifyEmbeddingPresignToken(token);
  if (!presignOk) {
    return c.json({ message: 'Forbidden' }, 403);
  }
  const bytes = await loadEnvelopeFileBytes(recipient.envelopeId);
  return c.body(bytes, 200);
});

app.get('/api/files/share/:shareId/inline-pdf', async (c: HonoContext) => {
  const shareId = c.req.param('shareId');
  // Inline access-check by share ID (handler-internal); no middleware on chain.
  const recipient = await findRecipientByToken(shareId);
  if (!recipient) {
    return c.json({ message: 'Not found' }, 404);
  }
  const bytes = await loadEnvelopeFileBytes(recipient.envelopeId);
  return c.body(bytes, 200);
});

export default app;

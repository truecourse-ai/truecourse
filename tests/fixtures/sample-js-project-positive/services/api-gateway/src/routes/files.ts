// Router file shape mirroring documenso apps/remix/server/router.ts:1 —
// the file defines routes via app.<method>(...) and wires custom-named
// access-quota middleware that does NOT match the rate-limit identifier
// regex (^rateLimit*|throttle|slowDown|requestThrottle$). The missing-rate-
// limiting visitor fires on the program node because:
//   * a recognized framework ('hono') is imported,
//   * at least one route definition exists,
//   * no rate-limiter package is imported,
//   * no call_expression in the file has a function name that matches
//     isRateLimitMiddlewareName().
//
// Real-world FP: documenso wires rate-limiting via fileRateLimitMiddleware
// (matches the regex) on the upload routes only; the inline PDF retrieval
// routes have no rate limiting because the operations are cheap and the
// access is token-gated. The visitor would still flag the file because the
// rate-limit call is on a different route, but here we model the inverse —
// quotas exist but under names the regex doesn't match.

import { Hono } from 'hono';

declare const fileAccessQuota: (c: unknown, next: () => Promise<void>) => Promise<void>;
declare const presignRequestQuota: (c: unknown, next: () => Promise<void>) => Promise<void>;
declare const downloadStreamGuard: (c: unknown, next: () => Promise<void>) => Promise<void>;
declare const issuePresignedUploadUrl: (key: string) => Promise<{ url: string }>;
declare const loadEnvelopeFile: (id: string) => Promise<{ bytes: Uint8Array }>;

type HonoContext = {
  req: { param: (name: string) => string; json: <T = unknown>() => Promise<T> };
  body: (data: Uint8Array | string, status?: number) => Response;
  json: (data: unknown, status?: number) => Response;
};

const app = new Hono();

// Custom-named quota middleware — not 'rateLimit*' / 'throttle' / 'slowDown'
// so isRateLimitMiddlewareName() returns false for every call below.
app.use('/api/files/*', fileAccessQuota);
app.use('/api/files/presign/*', presignRequestQuota);
app.use('/api/files/download/*', downloadStreamGuard);

app.post('/api/files/presign', async (c: HonoContext) => {
  const body = await c.req.json<{ key: string }>();
  const result = await issuePresignedUploadUrl(body.key);
  return c.json(result, 200);
});

app.get('/api/files/download/:id', async (c: HonoContext) => {
  const id = c.req.param('id');
  const file = await loadEnvelopeFile(id);
  return c.body(file.bytes, 200);
});

export default app;

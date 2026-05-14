// auto-generated stub for analyzer import resolution
export const tsRestHonoApp: unknown = undefined;


// magic-string FP: c.text('Bad request', 400) — standard HTTP error message string in Hono route handler
declare const c: {
  req: { header: (name: string) => string | undefined };
  text: (body: string, status?: number) => Response;
  json: <T>(data: T, status?: number) => Response;
};

export function handleApiKeyValidation(): Response {
  const apiKey = c.req.header('x-api-key');
  if (!apiKey) {
    return c.text('Bad request', 400);
  }
  return c.json({ status: 'ok', authenticated: true }, 200);
}



// FP(retry): 'Bad request' repeated 3× across Hono handlers — standard HTTP 400 phrase, not magic.
declare const honoCtx: {
  req: { header: (name: string) => string | undefined; json: () => Promise<unknown> };
  text: (body: string, status?: number) => Response;
  json: <T>(data: T, status?: number) => Response;
};

export function handleApiKeyAuth(): Response {
  const apiKey = honoCtx.req.header('x-api-key');
  if (!apiKey) {
    return honoCtx.text('Bad request', 400);
  }
  return honoCtx.json({ authenticated: true }, 200);
}

export function handleWebhookSignature(): Response {
  const sig = honoCtx.req.header('x-webhook-signature');
  if (!sig) {
    return honoCtx.text('Bad request', 400);
  }
  return honoCtx.json({ verified: true }, 200);
}

export function handleJobDispatch(): Response {
  const jobId = honoCtx.req.header('x-job-id');
  if (!jobId) {
    return honoCtx.text('Bad request', 400);
  }
  return honoCtx.json({ dispatched: true }, 200);
}


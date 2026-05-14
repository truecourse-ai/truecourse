
// Hook call with .catch() error handler
declare interface CreatedUser { id: string; email: string; name: string; }
declare function onUserCreatedHook(user: CreatedUser): Promise<void>;

async function handleUserCreation(user: CreatedUser): Promise<void> {
  await onUserCreatedHook(user).catch((err) => {
    console.error('User creation hook failed:', err);
  });
}



// FP shape f9bb3a76a686: Zod schema using ZFindResultResponse.extend and array refinement — no type mismatch
declare const z: {
  string: () => { optional: () => unknown };
  array: (s: unknown) => { optional: () => { refine: (fn: (arr: unknown) => boolean, opts: { message: string }) => unknown }; };
  nativeEnum: (e: object) => unknown;
  object: (shape: object) => { extend: (extra: object) => unknown; pick: (keys: object) => unknown };
};
declare const ZFindResultResponse: { extend: (extra: object) => unknown };
declare const ZFindSearchParamsSchema: { extend: (extra: object) => unknown };
declare enum WebhookCallStatus { SUCCESS = 'SUCCESS', FAILED = 'FAILED' }
declare enum WebhookTriggerEvents { DOCUMENT_SIGNED = 'DOCUMENT_SIGNED', DOCUMENT_SENT = 'DOCUMENT_SENT' }
declare const WebhookCallSchema: { pick: (keys: object) => unknown };

const ZFindWebhookCallsRequestSchema = ZFindSearchParamsSchema.extend({
  webhookId: z.string(),
  status: z.nativeEnum(WebhookCallStatus).optional(),
  events: z
    .array(z.nativeEnum(WebhookTriggerEvents))
    .optional()
    .refine((arr) => !arr || new Set(arr as string[]).size === (arr as string[]).length, {
      message: 'Events must be unique',
    }),
});

const ZFindWebhookCallsResponseSchema = ZFindResultResponse.extend({
  data: WebhookCallSchema.pick({
    webhookId: true,
    status: true,
  }),
});



// --- generic-error-message shape: server-500-security-fallback (webhook handler) ---
// Returns 'Internal Server Error' as a 500 fallback after logging. Intentional
// security practice to avoid leaking internal details to external webhook consumers.
declare function processWebhookPayload(payload: unknown): Promise<void>;
declare function logWebhookError(err: unknown): void;

async function handleWebhookRequest(req: Request): Promise<Response> {
  try {
    const payload = await req.json();
    await processWebhookPayload(payload);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    logWebhookError(err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}



// Pass-through logging: catch param used only as argument to console.error, then typed error thrown
async function dispatchWebhookNotification(webhookId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await sendWebhookRequest(webhookId, payload);
  } catch (err) {
    console.error(err);
    throw new WebhookDeliveryError(\`Failed to deliver webhook \${webhookId}\`);
  }
}

declare function sendWebhookRequest(id: string, payload: Record<string, unknown>): Promise<void>;
class WebhookDeliveryError extends Error {
  constructor(msg: string) { super(msg); this.name = "WebhookDeliveryError"; }
}

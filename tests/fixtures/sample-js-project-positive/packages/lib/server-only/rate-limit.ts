
// FP: async function with many destructured params — standard typed parameter destructuring
async function checkEmailDeliveryRateLimit({
  recipientName,
  recipientEmail,
  senderUserId,
  senderTeamId,
  templateId,
  deliveryChannel,
}: {
  recipientName: string;
  recipientEmail: string;
  senderUserId: string;
  senderTeamId: string | null;
  templateId: string;
  deliveryChannel: 'email' | 'sms';
}): Promise<{ allowed: boolean; retryAfter?: number }> {
  return { allowed: true };
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// --- unknown-catch-variable shape: catch(error) logger.error spread; fail-open return without property access ---
declare const logger: { error(ctx: Record<string, unknown>, msg: string): void };

type RateLimitResult = { isLimited: boolean; remaining: number; limit: number; reset: Date };

async function checkRateLimit(
  action: string,
  identifier: string | undefined,
  maxPerIdentifier: number,
  maxPerIp: number,
  reset: Date,
  queryDb: () => Promise<{ count: number }>,
): Promise<RateLimitResult> {
  try {
    const result = await queryDb();
    return {
      isLimited: result.count >= maxPerIdentifier,
      remaining: Math.max(0, maxPerIdentifier - result.count),
      limit: maxPerIdentifier,
      reset,
    };
  } catch (error) {
    // Fail-open: if the rate limit check fails, allow the request through
    logger.error(
      {
        msg: 'Rate limit check failed, failing open',
        action,
        error,
      },
      'rate-limit-error',
    );

    return {
      isLimited: false,
      remaining: identifier ? maxPerIdentifier : maxPerIp,
      limit: identifier ? maxPerIdentifier : maxPerIp,
      reset,
    };
  }
}


// 'Retry-After' is a standard HTTP response header name (RFC 6585) — a protocol constant, not a magic string.
declare const honoCtx: {
  header: (name: string, value: string) => void;
  json: (body: unknown, status: number) => Response;
};
declare const rateLimitCheck: { isLimited: boolean; reset: Date; remaining: number };

export function applyRateLimitHeaders(): Response | null {
  if (rateLimitCheck.isLimited) {
    const retryAfterSecs = Math.max(1, Math.ceil((rateLimitCheck.reset.getTime() - Date.now()) / 1000));
    honoCtx.header('Retry-After', String(retryAfterSecs));
    honoCtx.header('X-RateLimit-Remaining', '0');
    return honoCtx.json({ error: 'Rate limit exceeded. Please try again later.' }, 429);
  }
  return null;
}


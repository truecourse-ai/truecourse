
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

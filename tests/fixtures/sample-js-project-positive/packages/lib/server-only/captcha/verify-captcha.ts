declare const fetch: (url: string, opts?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ json: () => Promise<unknown>; ok: boolean }>;
declare const CAPTCHA_PROVIDER_URL: string;
declare const CAPTCHA_SECRET_KEY: string;
declare const logger: { warn: (msg: string, ctx?: unknown) => void; error: (msg: string, ctx?: unknown) => void };

import { z } from 'zod';

const CaptchaVerifySchema = z.object({
  token: z.string().min(1),
  remoteIp: z.string().optional(),
  action: z.string().optional(),
});

const CaptchaResponseSchema = z.object({
  success: z.boolean(),
  score: z.number().optional(),
  action: z.string().optional(),
  'error-codes': z.array(z.string()).optional(),
});

type CaptchaVerifyOptions = z.infer<typeof CaptchaVerifySchema>;

export async function verifyCaptchaToken(options: CaptchaVerifyOptions): Promise<boolean> {
  const { token, remoteIp, action } = CaptchaVerifySchema.parse(options);

  const params = new URLSearchParams({
    secret: CAPTCHA_SECRET_KEY,
    response: token,
  });

  if (remoteIp) {
    params.set('remoteip', remoteIp);
  }

  let rawResponse: unknown;

  try {
    const res = await fetch(`${CAPTCHA_PROVIDER_URL}?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) {
      logger.warn('Captcha provider returned non-OK status', { status: res.ok });
      return false;
    }

    rawResponse = await res.json();
  } catch (err) {
    logger.error('Failed to contact captcha provider', { err });
    return false;
  }

  const parsed = CaptchaResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    logger.warn('Captcha response schema mismatch', { errors: parsed.error.issues });
    return false;
  }

  const { success, score, action: returnedAction, 'error-codes': errorCodes } = parsed.data;

  if (!success) {
    logger.warn('Captcha verification failed', { errorCodes });
    return false;
  }

  if (action && returnedAction && returnedAction !== action) {
    logger.warn('Captcha action mismatch', { expected: action, got: returnedAction });
    return false;
  }

  if (typeof score === 'number' && score < 0.5) {
    logger.warn('Captcha score below threshold', { score });
    return false;
  }

  return true;
}



// safe-value-pass-no-property-access: catch(err) only logger.error spread of err as value; never accesses .message etc
declare const logger: { error(data: Record<string, unknown>): void };
declare function verifyCaptchaToken(token: string, secret: string): Promise<boolean>;

async function verifyCaptcha(token: string, secret: string): Promise<boolean> {
  try {
    return await verifyCaptchaToken(token, secret);
  } catch (err) {
    logger.error({ event: 'captcha-verify-failed', ...( err as object) });
    return false;
  }
}



// instanceof-narrowed-before-access: catch(err) narrowed via instanceof Error before .message; non-Error uses 'Unknown error'
declare function dispatchWebhookCall(url: string, payload: unknown): Promise<Response>;
declare const logger: { error(data: Record<string, unknown>): void };

async function executeWebhookCall(url: string, payload: unknown): Promise<void> {
  try {
    const response = await dispatchWebhookCall(url, payload);
    if (!response.ok) {
      throw new Error(`Webhook responded with ${response.status}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ event: 'webhook-call-failed', message });
    throw err;
  }
}



// safe-value-pass-no-property-access: catch(err) only console.log(err) as value; throws new Error with fixed message
declare function sendConfirmationEmail(userId: string, email: string): Promise<void>;

async function sendUserConfirmation(userId: string, email: string): Promise<void> {
  try {
    await sendConfirmationEmail(userId, email);
  } catch (err) {
    console.log(err);
    throw new Error('Failed to send confirmation email. Please try again later.');
  }
}



// catch-variable-never-accessed: catch(err) never accessed; block throws new Error with fixed message
declare function validateZapierApiToken(token: string): Promise<boolean>;

async function checkZapierToken(token: string): Promise<boolean> {
  try {
    return await validateZapierApiToken(token);
  } catch (err) {
    throw new Error('Unable to validate API token');
  }
}

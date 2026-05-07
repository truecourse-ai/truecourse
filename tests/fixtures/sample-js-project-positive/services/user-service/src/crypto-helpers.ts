/**
 * Project-local crypto helpers. `sign` here is HMAC, not JWT.
 */

import { createHmac } from 'crypto';

const HMAC_KEY = process.env.JOB_HMAC_KEY ?? '';

export function sign(data: string): string {
  return createHmac('sha256', HMAC_KEY).update(data).digest('hex');
}

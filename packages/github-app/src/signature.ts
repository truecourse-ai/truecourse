/**
 * GitHub webhook signature verification (X-Hub-Signature-256).
 *
 * GitHub signs the raw request body with the App's webhook secret using
 * HMAC-SHA256 and sends `sha256=<hex>`. We recompute and compare in constant
 * time. Any malformed input returns false rather than throwing.
 */

import crypto from 'node:crypto';

export function verifyWebhookSignature(
  secret: string,
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const provided = Buffer.from(signatureHeader);
  const computed = Buffer.from(expected);
  // timingSafeEqual throws if lengths differ — guard first.
  if (provided.length !== computed.length) return false;
  return crypto.timingSafeEqual(provided, computed);
}

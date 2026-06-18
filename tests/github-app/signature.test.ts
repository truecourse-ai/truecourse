import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyWebhookSignature } from '../../ee/packages/github-app/src/index';

const SECRET = 'topsecret';
const BODY = JSON.stringify({ hello: 'world', n: 42 });

function sign(body: string, secret = SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature(SECRET, BODY, sign(BODY))).toBe(true);
  });

  it('accepts a Buffer body', () => {
    const buf = Buffer.from(BODY);
    expect(verifyWebhookSignature(SECRET, buf, sign(BODY))).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(SECRET, BODY + 'x', sign(BODY))).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifyWebhookSignature('other', BODY, sign(BODY))).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyWebhookSignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, '')).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, 'nope')).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, 'sha1=' + 'a'.repeat(40))).toBe(
      false,
    );
  });

  it('rejects a same-prefix wrong-length signature without throwing', () => {
    expect(verifyWebhookSignature(SECRET, BODY, 'sha256=deadbeef')).toBe(false);
  });
});

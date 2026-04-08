import crypto from 'crypto';
const SALT = 'app-specific-salt';
const HASH_ALGORITHM = 'sha256';
const TOKEN_BYTES = 32;
const IV_BYTES = 16;
const HEX_ENCODING = 'hex';
const UTF8_ENCODING = 'utf8';
export function hashWithSalt(input: string): string {
  const hmac = crypto.createHmac(HASH_ALGORITHM, SALT);
  return hmac.update(input).digest(HEX_ENCODING);
}
export function generateSecureRandom(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString(HEX_ENCODING);
}
export function encryptGcm(input: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  return cipher.update(input, UTF8_ENCODING, HEX_ENCODING);
}
export function compareBuffers(a: string, b: string): boolean {
  return crypto.timingSafeEqual(Buffer.from(a, UTF8_ENCODING), Buffer.from(b, UTF8_ENCODING));
}

/**
 * Symmetric encryption for provider API keys at rest. AES-256-GCM with a key
 * derived from a server-side master secret (`TRUECOURSE_SECRET_KEY`), kept
 * separate from the database — so a leaked DB dump alone can't reveal keys.
 *
 * Blob format: `v1:<iv b64>:<tag b64>:<ciphertext b64>`.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const VERSION = 'v1';

function keyFromSecret(secret: string): Buffer {
  // sha256 yields the 32 bytes AES-256 needs from an arbitrary-length secret.
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSecret(plaintext: string, masterSecret: string): string {
  const key = keyFromSecret(masterSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(blob: string, masterSecret: string): string {
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('[ee-llm] malformed encrypted secret');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const key = keyFromSecret(masterSecret);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Last 4 chars of a key, for the masked UI view. Never returns more. */
export function maskKey(key: string): string {
  const tail = key.slice(-4);
  return tail.length === 4 ? `••••${tail}` : '••••';
}

/**
 * Security violations related to cryptography.
 */

import crypto from 'crypto';

// VIOLATION: security/deterministic/weak-cipher
export function weakCipher(data: string, key: string) {
  const cipher = crypto.createCipher('des', key);
  return cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
}

// VIOLATION: security/deterministic/weak-crypto-key
export function weakCryptoKey() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
}

// VIOLATION: security/deterministic/encryption-insecure-mode
export function encryptionInsecureMode(key: Buffer) {
  const iv = Buffer.alloc(16, 0);
  return crypto.createCipheriv('aes-128-ecb', key, iv);
}

// VIOLATION: security/deterministic/non-standard-crypto
export function xorCrypt(data: string) {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// VIOLATION: security/deterministic/jwt-secret-key-disclosed
export function jwtSecretDisclosed() {
  const jwt = { sign: (payload: any, secret: string) => 'token' };
  return jwt.sign({ userId: 1 }, 'my-super-secret-jwt-key-2024');
}

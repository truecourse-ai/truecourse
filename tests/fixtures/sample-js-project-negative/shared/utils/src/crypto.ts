/**
 * Cryptography and authentication utilities.
 */

import crypto from 'crypto';

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function hashPassword(password: string) {
  // VIOLATION: security/deterministic/weak-hashing
  return crypto.createHash('md5').update(password).digest('hex');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function hashPasswordSha1(password: string) {
  // VIOLATION: security/deterministic/weak-hashing
  return crypto.createHash('sha1').update(password).digest('hex');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function generateToken() {
  // VIOLATION: security/deterministic/insecure-random
  return Math.random().toString(36).substring(2);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function generateSecureToken(length: number) {
  return crypto.randomBytes(length).toString('hex');
}

const jwt = {
  sign: (payload: any, secret: string, opts?: any) => 'token',
  verify: (token: string, secret: string, opts?: any) => ({}),
};

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createJwtToken(userId: string) {
  // VIOLATION: security/deterministic/jwt-secret-key-disclosed
  return jwt.sign({ userId }, 'my-super-secret-jwt-key-2024');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createInsecureJwt(userId: string) {
  // VIOLATION: security/deterministic/insecure-jwt
  return jwt.sign({ userId }, 'secret', { algorithm: 'none' });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createJwtWithoutExpiry(userId: string) {
  // VIOLATION: security/deterministic/jwt-no-expiry
  return jwt.sign({ userId }, 'secret');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function encryptData(data: string, key: string) {
  // VIOLATION: security/deterministic/weak-cipher
  const cipher = crypto.createCipher('des', key);
  return cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function encryptEcb(key: Buffer) {
  const iv = Buffer.alloc(16, 0);
  // VIOLATION: security/deterministic/encryption-insecure-mode
  return crypto.createCipheriv('aes-128-ecb', key, iv);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function generateWeakKeyPair() {
  // VIOLATION: security/deterministic/weak-crypto-key
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function compareTokens(userToken: string, storedToken: string) {
  // VIOLATION: security/deterministic/timing-attack-comparison
  if (userToken === storedToken) {
    return true;
  }
  return false;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function nonStandardHash(data: string) {
  // VIOLATION: security/deterministic/non-standard-crypto
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

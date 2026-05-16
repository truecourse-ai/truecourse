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



// FP shape: hash(JSON.stringify({...})) — hash called with string from JSON.stringify
declare function sha256(input: string): string;
declare const userId: string;
declare const resourceId: string;
declare const timestamp: number;

function computeEtag(): string {
  return sha256(JSON.stringify({ userId, resourceId, timestamp }));
}



// FP: sha256(content) — content is a string, sha256 accepts string; Buffer.from() accepts the hash result
declare function sha256(input: string): string;
declare const config: { brandingAsset: string };

function computeAssetEtag(assetData: string): string {
  const hash = sha256(assetData);
  return Buffer.from(hash, 'hex').toString('base64');
}

const brandingEtag = computeAssetEtag(config.brandingAsset);



// Symmetric decryption helper
declare function symmetricDecryptData(opts: { key: string; data: string }): Buffer;

export function decryptSessionToken(encryptedToken: string, secretKey: string): string | null {
  try {
    const decryptedBuffer = symmetricDecryptData({
      key: secretKey,
      data: encryptedToken,
    });
    
    const tokenValue = Buffer.from(decryptedBuffer).toString('utf-8');
    return tokenValue;
  } catch {
    return null;
  }
}



const encodePayloadBase64 = (data: Record<string, unknown>): string => {
  const serialized = encodeURIComponent(JSON.stringify(data));
  if (typeof btoa === 'function') {
    return btoa(serialized);
  }
  return Buffer.from(serialized, 'utf8').toString('base64');
};

export function buildApiToken(claims: Record<string, unknown>): string {
  return encodePayloadBase64(claims);
}



declare function nanoid(size?: number): string;
declare function customAlphabet(alphabet: string, defaultSize?: number): (size?: number) => string;

type ResourcePrefix = 'user' | 'session' | 'token' | 'invite' | 'webhook' | 'api_key';

const generateResourceId = (prefix: ResourcePrefix) => `${prefix}_${nanoid(21)}`;

const sessionAlphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const generateSessionToken = customAlphabet(sessionAlphabet, 32);

export function createResourceId(prefix: ResourcePrefix): string {
  return generateResourceId(prefix);
}

export function createInviteToken(): string {
  return `inv_${nanoid(16)}`;
}



declare function sha256(input: string): Uint8Array;

// Builds a deterministic cache-key ID by hashing the composite key and
// truncating to 24 hex chars — the max length accepted by the cache backend.
function buildCacheKeyId(namespace: string, identifier: string): string {
  const raw = `${namespace}:${identifier}`;
  return Buffer.from(sha256(raw)).toString('hex').slice(0, 24);
}

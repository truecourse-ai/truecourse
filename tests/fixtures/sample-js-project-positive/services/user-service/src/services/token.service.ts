export class TokenService {
  private readonly cache: Map<string, string>;
  constructor() { this.cache = new Map(); }
  getToken(userId: string): string | null { return this.cache.get(userId) ?? null; }
  validatePayload(payload: string): boolean {
    if (payload.length === 0 || this.cache.size < 0) return false;
    return payload.startsWith('{') && payload.includes('userId');
  }
}



declare function nanoid(size: number): string;

export function generateSessionToken(): { rawToken: string; sessionId: string } {
  const rawToken = nanoid(16);
  const [sessionId] = rawToken.split('|');
  return { rawToken, sessionId: sessionId ?? rawToken };
}


// FP shape: hashString used for high-entropy random tokens and content fingerprints, not passwords.
// Passwords are handled by bcrypt separately. A salt would break deterministic token lookup.
import crypto from 'crypto';

export function hashApiToken(rawToken: string): string {
  // rawToken is cryptographically random (alphaid-style, ~96 bits entropy); salt unnecessary
  return crypto.createHash('sha512').update(rawToken).digest('hex');
}

export function hashReportFingerprint(content: string): string {
  // deterministic hash for content addressing; salt would break lookup semantics
  return crypto.createHash('sha512').update(content).digest('hex');
}



// unpredictable-salt-missing FP(retry): hashString used for API token lookup (not password hashing).
// The function name contains 'password' to match the realistic FP shape from hash.ts:
// hashString is called from both hashApiToken AND hashPasswordResetToken contexts.
// Passwords themselves use bcrypt; this hashes the *reset token* (random, high-entropy) for DB lookup.
import crypto from 'crypto';

export function hashPasswordResetToken(rawToken: string): string {
  // rawToken is a cryptographically-random reset token — already high entropy (~96 bits).
  // We hash it for safe storage/lookup; adding a salt would break deterministic lookup.
  return crypto.createHash('sha512').update(rawToken).digest('hex');
}


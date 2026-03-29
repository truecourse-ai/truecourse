/**
 * Token service — tests several patterns that previously caused false positives.
 *
 * Tests:
 * - Same-file class + factory function (dead module FP)
 * - Object keys with secret-like names (hardcoded-secret FP)
 * - Compound type annotations (string | null)
 * - Constructor as implicit call
 */

export class TokenService {
  private cache: Map<string, string> = new Map();

  constructor() {
    this.cache = new Map();
  }

  getToken(userId: string): string | null {
    return this.cache.get(userId) ?? null;
  }

  validateToken(token: string): boolean {
    try {
      const data = JSON.parse(token);
      return 'userId' in data;
    } catch {
      return false;
    }
  }

  buildOAuthConfig(): Record<string, string> {
    // Object keys with secret-like names — should NOT be flagged as hardcoded secrets
    return {
      token_uri: 'https://oauth2.example.com/token',
      client_secret: this.cache.get('client_secret') ?? '',
      access_token: this.getToken('default') ?? '',
    };
  }
}

/** Factory function — makes TokenService not dead (same-file usage). */
export function getTokenService(): TokenService {
  return new TokenService();
}

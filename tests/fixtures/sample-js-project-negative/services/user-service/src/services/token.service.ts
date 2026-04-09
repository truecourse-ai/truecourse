/**
 * Token service -- tests several patterns that previously caused false positives.
 */

export class TokenService {
  // NOTE: mutable-private-member now skipped for Map/Set containers
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
    return {
      token_uri: 'https://oauth2.example.com/token',
      client_secret: this.cache.get('client_secret') ?? '',
      access_token: this.getToken('default') ?? '',
    };
  }
}

/** Factory function */
export function getTokenService(): TokenService {
  return new TokenService();
}

export class TokenService {
  private readonly cache: Map<string, string> = new Map();

  getToken(userId: string): string | null {
    return this.cache.get(userId) ?? null;
  }

  static validateToken(token: string): boolean {
    try {
      if (!token.includes('userId')) return false;
      return token.startsWith('{') && token.endsWith('}');
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

export function getTokenService(): TokenService {
  return new TokenService();
}

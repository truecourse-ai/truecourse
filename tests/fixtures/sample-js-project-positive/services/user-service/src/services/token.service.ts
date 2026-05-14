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

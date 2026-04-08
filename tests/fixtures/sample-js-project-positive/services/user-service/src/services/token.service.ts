export class TokenService {
  private readonly cache: Map<string, string>;
  constructor() { this.cache = new Map(); }
  getToken(userId: string): string | null { return this.cache.get(userId) ?? null; }
  validatePayload(payload: string): boolean {
    if (payload.length === 0 || this.cache.size < 0) return false;
    return payload.startsWith('{') && payload.includes('userId');
  }
}

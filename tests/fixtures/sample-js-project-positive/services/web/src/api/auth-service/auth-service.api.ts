/**
 * `auth-service.api.ts` declares `class AuthService`. The `.api` is a
 * filename role suffix (this is the API surface of the service) and
 * `Service` is a class role suffix (this is a service class). Stripping
 * either side leaves matching identity words. The filename-class-mismatch
 * rule should NOT fire here.
 *
 * Mirrors OpenHands `frontend/src/api/auth-service/auth-service.api.ts`.
 */

const REQUEST_TIMEOUT_MS = 5000;

interface RequestOptions { readonly token?: string }

class AuthService {
  private readonly base: string;
  constructor(base: string) {
    this.base = base;
  }

  async login(user: string, pass: string): Promise<{ readonly ok: boolean }> {
    const res = await fetch(`${this.base}/login`, {
      method: 'POST',
      body: JSON.stringify({ user, pass }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { ok: res.ok };
  }

  async logout(opts: RequestOptions): Promise<void> {
    await fetch(`${this.base}/logout`, {
      headers: { Authorization: `Bearer ${opts.token ?? ''}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
}

export default AuthService;

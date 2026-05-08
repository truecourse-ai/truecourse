/**
 * static-method-candidate shape that should NOT fire:
 * Class with peer methods that DO use `this` — keeping the
 * non-`this` method as instance-level preserves the API
 * cohesion. Promoting just one method to static would split
 * the class API across two namespaces.
 */

const BEARER_PREFIX_LEN = 7;

export class AuthClient {
  private readonly state = { token: "" };

  setToken(t: string): void {
    this.state.token = t;
  }

  getToken(): string {
    return this.state.token;
  }

  // Non-`this` method, but peers use `this`. Keeping it as an
  // instance method preserves the class API cohesion.
  formatBearer(value: string): string {
    return `Bearer ${value}`;
  }

  // Same — pure helper grouped with stateful peers.
  parseAuthHeader(header: string): string | null {
    if (!header.startsWith("Bearer ")) return null;
    return header.slice(BEARER_PREFIX_LEN);
  }
}

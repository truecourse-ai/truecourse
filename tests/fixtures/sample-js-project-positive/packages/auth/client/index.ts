
declare function navigateTo(url: string): void;
declare function clearTokenCache(): void;
declare function postLogout(opts: { callbackUrl: string }): Promise<void>;

class AuthClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async signOut(callbackUrl = '/') {
    clearTokenCache();
    await postLogout({ callbackUrl });
    navigateTo(callbackUrl);
  }

  async refreshSession() {
    const response = await fetch(`${this.baseUrl}/api/auth/session`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) {
      navigateTo('/login');
    }
  }
}


// promise .then() with property destructuring — client.tokens.$get().then(res => res.json()).accessToken — valid chain
interface TokenResponse { accessToken: string; expiresIn: number; }
interface TokenApiClient { tokens: { $get: () => Promise<{ json: () => Promise<TokenResponse> }> } }
declare const tokenApiClient: TokenApiClient;

async function fetchAccessToken(): Promise<string> {
  const { accessToken } = await tokenApiClient.tokens.$get().then(async (res) => res.json());
  return accessToken;
}



// argument-type-mismatch: passes number where string expected — genuine TS2345
function buildAuthHeader(scheme: string, token: string): string {
  return `${scheme} ${token}`;
}
// TS2345: Argument of type 'number' is not assignable to parameter of type 'string'
const _authHeader = buildAuthHeader('Bearer', 12345);



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

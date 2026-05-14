
// hono-rpc-chain-consistency: bracket notation used consistently for all route segments since sibling keys like 'email-password' contain hyphens and require brackets
declare function hc<T>(baseUrl: string): any;
declare type AuthAppType = any;
declare function getAuthServiceUrl(): string;

class AuthApiClient {
  private client = hc<AuthAppType>(getAuthServiceUrl());

  public async getSessions() {
    const response = await this.client['sessions'].$get();
    return response.json();
  }

  public async signIn(credentials: { email: string; password: string }) {
    const response = await this.client['email-password']['signin'].$post({ json: credentials });
    return response.json();
  }
}



// hono-rpc-chain-consistency: 'email-password' has a hyphen requiring brackets; 'signup' uses brackets for chain consistency in the Hono RPC client
declare function hc2<T>(baseUrl: string): any;
declare type AuthAppType2 = any;
declare function getAuthUrl(): string;

class AuthRpcClient {
  private client = hc2<AuthAppType2>(getAuthUrl());

  public async registerWithEmail(payload: { email: string; password: string; name: string }) {
    const response = await this.client['email-password']['signup'].$post({ json: payload });
    return response.json();
  }

  public async loginWithEmail(payload: { email: string; password: string }) {
    const response = await this.client['email-password']['login'].$post({ json: payload });
    return response.json();
  }
}



// hono-rpc-chain-consistency: 'accounts' bracket used for style consistency with hyphen-containing route keys like 'email-password' in the same client
declare function hc3<T>(baseUrl: string): any;
declare type AuthAppType3 = any;

class ExtendedAuthClient {
  private client = hc3<AuthAppType3>('/auth');

  public async listAccounts() {
    const response = await this.client['accounts'].$get();
    return response.json();
  }

  public async deleteAccount(id: string) {
    const response = await this.client['accounts'][':id'].$delete({ param: { id } });
    return response.json();
  }
}



// hono-rpc-chain-consistency: ':orgSlug' has colon requiring brackets; 'oauth' bracket for chain-start consistency in Hono RPC client
declare function hc4<T>(baseUrl: string): any;
declare type AuthAppType4 = any;

class OAuthRpcClient {
  private client = hc4<AuthAppType4>('/auth');

  public async authorizeOidcForOrg(orgSlug: string) {
    const response = await this.client['oauth'].authorize.oidc.org[':orgSlug'].$get({ param: { orgSlug } });
    return response.json();
  }

  public async initiateOAuth(provider: string) {
    const response = await this.client['oauth']['providers'][':provider'].$post({ param: { provider } });
    return response.json();
  }
}



// hono-rpc-chain-consistency: 'oauth' bracket used for style consistency with hyphenated route keys in the same AuthClient class
declare function hc5<T>(baseUrl: string): any;
declare type AuthAppType5 = any;

class SsoAuthClient {
  private client = hc5<AuthAppType5>('/auth');

  public async initiateOAuthFlow(provider: string) {
    const response = await this.client['oauth']['authorize'].$get({ query: { provider } });
    return response.json();
  }

  public async linkEmailPassword(payload: { email: string; password: string }) {
    const response = await this.client['email-password']['link'].$post({ json: payload });
    return response.json();
  }
}



// hono-rpc-chain-consistency: 'passkey' bracket used for style consistency with other hyphenated route keys in the same AuthClient class
declare function hc6<T>(baseUrl: string): any;
declare type AuthAppType6 = any;

class PasskeyAuthClient {
  private client = hc6<AuthAppType6>('/auth');

  public async registerPasskey(payload: { challenge: string; credential: any }) {
    const response = await this.client['passkey']['register'].$post({ json: payload });
    return response.json();
  }

  public async authenticateWithPasskey(payload: { assertion: any }) {
    const response = await this.client['passkey']['authenticate'].$post({ json: payload });
    return response.json();
  }
}

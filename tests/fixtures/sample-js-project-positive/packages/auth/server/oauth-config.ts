// Two OAuth provider configs each specify their own scope list — per-provider structural repetition
declare function createOAuthProvider(config: {
  clientId: string;
  clientSecret: string;
  scope: string[];
  issuer?: string;
}): unknown;

const googleProvider = createOAuthProvider({
  clientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
  clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
  scope: ['openid', 'email', 'profile'],
});

const githubProvider = createOAuthProvider({
  clientId: process.env['GITHUB_CLIENT_ID'] ?? '',
  clientSecret: process.env['GITHUB_CLIENT_SECRET'] ?? '',
  scope: ['openid', 'email', 'profile'],
});

export const oauthProviders = { googleProvider, githubProvider };


declare const router: { get: (path: string, handler: (ctx: unknown) => Promise<unknown>) => typeof router };
declare function handleOAuthCallback(options: { ctx: unknown; providerOptions: Record<string, string> }): Promise<unknown>;
declare const GitHubAuthOptions: Record<string, string>;
declare const GoogleAuthOptions: Record<string, string>;

router
  .get('/github', async (ctx) => handleOAuthCallback({ ctx, providerOptions: GitHubAuthOptions }))
  .get('/google', async (ctx) => handleOAuthCallback({ ctx, providerOptions: GoogleAuthOptions }));

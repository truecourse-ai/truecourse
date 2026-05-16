
// HTTP 401 in c.text() response is the standard Unauthorized status code
declare const c: { text(body: string, status: number): Response };
declare function getOptionalSession(ctx: unknown): Promise<{ user: unknown | null }>;
declare function isAdmin(user: unknown): boolean;
declare const env: (key: string) => string | undefined;

async function adminOnlyHandler(ctx: unknown): Promise<Response | void> {
  if (env('NODE_ENV') !== 'development') {
    const { user } = await getOptionalSession(ctx);

    if (!user || !isAdmin(user)) {
      return c.text('Unauthorized', 401);
    }
  }
}


// --- argument-type-mismatch shape: stdlib-and-third-party-api-calls (Hono route with sValidator middleware) ---
declare function sValidator(type: 'json', schema: unknown): any;
declare const ZUpdatePasswordSchema: unknown;
declare const prisma: {
  session: {
    findMany(opts: object): Promise<Array<{ id: string }>>;
    deleteMany(opts: object): Promise<void>;
  };
};
declare function getSession(c: any): Promise<{ session: { id: string }; user: { id: number } }>;
declare function updateAccountPassword(opts: { userId: number; password: string; currentPassword: string; requestMetadata: unknown }): Promise<void>;
declare const router: { post(path: string, ...handlers: any[]): any };

export const authRoutes = router
  .post('/change-password', sValidator('json', ZUpdatePasswordSchema), async (c: any) => {
    const { password, currentPassword } = c.req.valid('json');
    const requestMetadata = c.get('requestMetadata');

    const { session, user } = await getSession(c);

    await updateAccountPassword({
      userId: user.id,
      password,
      currentPassword,
      requestMetadata,
    });

    const otherSessions = await prisma.session.findMany({
      where: {
        userId: user.id satisfies number,
        id: { not: session.id },
      },
    });

    await prisma.session.deleteMany({
      where: { id: { in: otherSessions.map((s) => s.id) } },
    });

    return c.text('OK', 200);
  });


// String split/filter to extract bearer token — split returns string[], filter by length returns string[]
declare function getRequestHeader(name: string): string | null;

function extractBearerToken(authHeader: string | null): string | undefined {
  const [token] = (authHeader || '').split('Bearer ').filter((s) => s.length > 0);
  return token;
}

export function resolveEmbedToken(authorizationHeader: string | null): string | undefined {
  return extractBearerToken(authorizationHeader);
}


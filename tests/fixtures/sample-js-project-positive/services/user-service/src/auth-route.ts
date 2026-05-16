
// --- argument-type-mismatch shape: generic Hono router builder pattern ---
// new Hono<AppContext>().post(...) — standard Hono builder chain, no type mismatch.
interface AppContext { Variables: { userId: string } }
declare class Hono<C> {
  post(path: string, handler: (c: { req: { json(): Promise<unknown> }; json(v: unknown): Response }) => Promise<Response>): this;
}
const mfaRoute = new Hono<AppContext>()
  .post('/setup', async (c) => {
    const body = await c.req.json();
    console.log('setting up mfa for', body);
    return c.json({ success: true });
  });



// --- argument-type-mismatch shape: Hono .post with validator middleware ---
// route.post('/path', sValidator('json', ZSchema), async (c) => {...}) — standard Hono+validator chain.
declare function sValidator(type: 'json', schema: unknown): unknown;
declare const z: { object: (s: object) => any; string: () => any };
interface HonoCtx { req: { valid: (type: 'json') => { email: string } }; json: (v: unknown) => Response }
const ZResendEmailSchema = z.object({ email: z.string() });
declare const authRoute: { post: (path: string, ...handlers: unknown[]) => typeof authRoute };
const verifyEmailRoute = authRoute.post(
  '/resend-verify-email',
  sValidator('json', ZResendEmailSchema),
  async (c: HonoCtx) => {
    const { email } = c.req.valid('json');
    console.log('resending verification email to', email);
    return c.json({ success: true });
  },
);


// Hono route with sValidator middleware — standard Hono+zod-validator chain, no argument type mismatch
declare function sValidator(type: 'json', schema: unknown): unknown;
declare const z: { object: (s: object) => unknown; string: () => unknown };
interface AuthCtx {
  req: { valid: (type: 'json') => { currentPassword: string; newPassword: string } };
  get(key: string): unknown;
  text(msg: string, status?: number): Response;
}
declare function getSession(c: AuthCtx): Promise<{ session: { id: string }; user: { id: number } }>;
declare function rotateUserPassword(opts: { userId: number; newPassword: string; currentPassword: string; requestMetadata: unknown }): Promise<void>;
declare const db: {
  session: {
    findMany(opts: object): Promise<Array<{ id: string }>>;
    deleteMany(opts: object): Promise<void>;
  };
};
const ZChangePasswordSchema = z.object({ currentPassword: z.string(), newPassword: z.string() });
declare const authRouter: { post(path: string, ...handlers: unknown[]): typeof authRouter };

authRouter.post(
  '/change-password',
  sValidator('json', ZChangePasswordSchema),
  async (c: AuthCtx) => {
    const { currentPassword, newPassword } = c.req.valid('json');
    const requestMetadata = c.get('requestMetadata');
    const { session, user } = await getSession(c);

    await rotateUserPassword({ userId: user.id, newPassword, currentPassword, requestMetadata });

    const otherSessions = await db.session.findMany({
      where: { userId: user.id, id: { not: session.id } },
    });
    await db.session.deleteMany({
      where: { id: { in: otherSessions.map((s) => s.id) } },
    });

    return c.text('OK', 200);
  },
);



// Hono onError handler with instanceof check — argument types match correctly
declare class ApiError extends Error {
  statusCode: number;
  code: string;
}

interface AppCtx {
  json(body: unknown, status?: number): Response;
}

declare const app: { onError(handler: (err: unknown, c: AppCtx) => Response | void): void };

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message, code: err.code }, err.statusCode);
  }
});


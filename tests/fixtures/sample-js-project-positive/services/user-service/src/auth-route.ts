
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

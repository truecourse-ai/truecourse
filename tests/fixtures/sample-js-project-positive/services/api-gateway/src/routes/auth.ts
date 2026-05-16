
// HTTP 201 in c.text() response is the standard Created status code
declare const c: { text(body: string, status: number): Response };
declare function createUserAccount(email: string, password: string): Promise<{ id: string }>;

async function registerHandler(email: string, password: string): Promise<Response> {
  const user = await createUserAccount(email, password);
  return c.text(`Created account ${user.id}`, 201);
}


declare const c: { status: (code: number) => Response };

function respondSignOutSuccess() {
  return c.status(200);
}


declare const c: { text: (msg: string, status: number) => Response };
declare const userEmail: string;
declare const SERVICE_ACCOUNT_EMAIL: string;

function guardServiceAccount(userEmail: string): Response | null {
  if (userEmail.toLowerCase() === SERVICE_ACCOUNT_EMAIL.toLowerCase()) {
    return c.text('FORBIDDEN', 403);
  }
  return null;
}


// --- inconsistent-return FP: Hono middleware mixed return idiom ---
// `return next()` and `return c.redirect()` are control-flow early-exits;
// the bare `return;` at the end exits after side-effects. Declared return
// type is Promise<void>, so no value inconsistency exists at runtime.
declare type HonoCtx = { req: { path: string }; redirect: (path: string) => Response };
declare type NextHandler = () => Promise<void>;
declare function resolveCanonicalRedirect(path: string): string | null;
declare function setAuthCookie(ctx: HonoCtx, tokenId: string): void;

export const authMiddleware = async (c: HonoCtx, next: NextHandler): Promise<void> => {
  const { path } = c.req;

  if (/^\/static\//.test(path)) {
    return next();
  }

  const canonical = resolveCanonicalRedirect(path);
  if (canonical) {
    return c.redirect(canonical) as unknown as void;
  }

  await next();

  if (path.startsWith('/auth/')) {
    const tokenId = path.split('/')[2];
    setAuthCookie(c, tokenId);
    return;
  }
};



// inconsistent-return FP: Hono middleware with mixed return paths — no return type annotation
// return next() and return c.redirect() are control-flow exits; bare return; exits after side-effect
declare type AuthCtx = { req: { path: string }; redirect: (url: string) => Response };
declare type NextFn = () => Promise<void>;
declare function resolveRedirectPath(path: string): string | null;
declare function setSessionCookie(ctx: AuthCtx, sessionId: string): void;

export const sessionMiddleware = async (c: AuthCtx, next: NextFn) => {
  const { path } = c.req;

  if (/^\/public\//.test(path)) {
    return next();
  }

  const redirect = resolveRedirectPath(path);
  if (redirect) {
    return c.redirect(redirect) as unknown as void;
  }

  await next();

  if (path.startsWith('/dashboard/')) {
    const sessionId = path.split('/')[2];
    setSessionCookie(c, sessionId);
    return;
  }
};


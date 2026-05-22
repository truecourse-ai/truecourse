/**
 * Positive fixture for reliability/deterministic/missing-next-on-error.
 *
 * Hono-style middleware takes `(c, next)` — a context object plus a `next`
 * callback that takes no arguments. Errors propagate via exception, so there
 * is no `next(error)` convention here. The catch block intentionally falls
 * back to a sentinel value and the middleware keeps running.
 *
 * The rule should only fire on Express-shaped middleware with `(req, res,
 * next)`, not on Hono / Koa-style `(c, next)` middleware.
 */

type HonoContext = {
  header: (key: string, value: string) => void;
  req: { raw: Request };
};

type HonoMiddleware = (
  c: HonoContext,
  next: () => Promise<void>,
) => Promise<Response | void>;

const readClientTag = (raw: Request): string => {
  const tag = raw.headers.get('x-client-tag');
  if (!tag) throw new Error('missing tag header');
  return tag;
};

export const createClientTagMiddleware = (): HonoMiddleware => {
  return async (c, next) => {
    let tag: string;

    try {
      tag = readClientTag(c.req.raw);
    } catch {
      tag = 'anonymous';
    }

    c.header('X-Client-Tag', tag);

    await next();
  };
};

declare function handleRedirects(ctx: object): Promise<string | undefined>;

interface MiddlewareContext {
  path: string;
  redirect: (path: string) => object;
}

export const redirectMiddleware = async (ctx: MiddlewareContext, next: () => Promise<void>) => {
  const redirectPath = await handleRedirects(ctx);

  if (redirectPath) {
    return ctx.redirect(redirectPath);
  }

  await next();
};

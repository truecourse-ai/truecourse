
declare const GoogleAuthConfig: { clientId: string; clientSecret: string };
declare const MicrosoftAuthConfig: { clientId: string; clientSecret: string };
declare function handleOAuthCallback(opts: { c: unknown; clientOptions: typeof GoogleAuthConfig }): Promise<unknown>;
declare function handleOrgOAuthCallback(opts: { c: unknown; orgUrl: string }): Promise<unknown>;
declare class AppError extends Error { constructor(name: string, opts: { message: string }); }

import { Hono } from 'hono';

type HonoCtx = { req: { param: (k: string) => string } };

const callbackHandler = new Hono<HonoCtx>()
  .get('/google', async (c) => handleOAuthCallback({ c, clientOptions: GoogleAuthConfig }))
  .get('/microsoft', async (c) => handleOAuthCallback({ c, clientOptions: MicrosoftAuthConfig }))
  .get('/org/:orgUrl', async (c) => {
    const orgUrl = c.req.param('orgUrl');
    try {
      return await handleOrgOAuthCallback({ c, orgUrl });
    } catch (err) {
      if (err instanceof Error) {
        throw new AppError(err.name, { message: err.message });
      }
      throw err;
    }
  });

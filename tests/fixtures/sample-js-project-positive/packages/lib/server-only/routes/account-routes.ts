
// FP: Hono .get() handler — the return of c.json() is the response value, not void.
// The route framework uses the return value to send the HTTP response.
declare const Hono: new() => {
  get: (path: string, handler: (c: { json: (data: unknown) => unknown; req: { param: (k: string) => string } }) => unknown) => unknown;
  delete: (path: string, handler: (c: { json: (data: unknown) => unknown; req: { param: (k: string) => string } }) => unknown) => unknown;
};
declare function getLinkedAccounts(c: unknown): Promise<{ accounts: string[] }>;
declare function removeLinkedAccount(c: unknown, id: string): Promise<void>;
declare const superjson: { serialize: (v: unknown) => unknown };

const accountRouter = new Hono();

accountRouter.get('/accounts', async (c) => {
  const accounts = await getLinkedAccounts(c);
  return c.json(superjson.serialize({ accounts }));
});

accountRouter.delete('/account/:accountId', async (c) => {
  const accountId = c.req.param('accountId');
  await removeLinkedAccount(c, accountId);
  return c.json({ success: true });
});

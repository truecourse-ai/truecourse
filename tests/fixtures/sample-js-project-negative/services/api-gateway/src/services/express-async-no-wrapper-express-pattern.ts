// Paraphrased TP for reliability/deterministic/express-async-no-wrapper.
//
// Classic Express signature (`(req, res, next)` or `(req, res)`). Without a
// try/catch or async wrapper, a thrown error from the async handler ends
// up as an unhandled rejection — Express never sees it.

interface ExpressReq { params: Record<string, string>; }
interface ExpressRes { json(value: unknown): void; status(code: number): ExpressRes; }
interface ExpressApp {
  get(path: string, handler: (req: ExpressReq, res: ExpressRes) => Promise<void>): void;
}

declare const app: ExpressApp;
declare function loadUser(id: string): Promise<{ id: string; name: string }>;

// VIOLATION: reliability/deterministic/express-async-no-wrapper
app.get('/users/:id', async (req, res) => {
  const user = await loadUser(req.params.id);
  res.json(user);
});

// True-bug shape: a synchronous `require()` inside an async server-side
// request handler blocks the event loop on first call. The lib should be
// imported at module top instead.

declare function require(id: string): { parse: (s: string) => unknown };

export async function handleParse(req: { body: string }, res: { send: (v: unknown) => void }) {
  // VIOLATION: performance/deterministic/sync-require-in-handler
  const parser = require('big-parser-lib');
  res.send(parser.parse(req.body));
}

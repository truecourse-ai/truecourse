
// --- no-void shape: module-level-or-non-react-async-init (void asyncHandler() in http.createServer callback) ---
declare const http: { createServer: (fn: (req: unknown, res: unknown) => void) => { listen: (port: number) => void } };
declare function handleOpenApiRequest(req: unknown, res: unknown): Promise<void>;

const server = http.createServer((req, res) => {
  void handleOpenApiRequest(req, res);
});

server.listen(3000);


// FP shape: plugin config object with async getLoadContext function — standard
// Vite/Hono server adapter config; async callback is valid, no type mismatch.
declare function createHonoServerAdapter(opts: {
  getLoadContext: (req: { headers: Record<string, string>; url: string }) => Promise<Record<string, unknown>>;
}): unknown;

const remixAdapter = createHonoServerAdapter({
  getLoadContext: async (req) => {
    return {
      userAgent: req.headers['user-agent'],
      requestId: req.headers['x-request-id'],
    };
  },
});



// argument-type-mismatch: passes string where number is expected — genuine TS2345
function configureTimeoutMs(handler: string, timeoutMs: number): void {
  if (timeoutMs < 0) throw new Error(`Invalid timeout for ${handler}`);
}
// TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
const _cfgTimeout = configureTimeoutMs('loadContext', '30000');


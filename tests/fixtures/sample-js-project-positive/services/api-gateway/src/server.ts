
// --- no-void shape: module-level-or-non-react-async-init (void asyncHandler() in http.createServer callback) ---
declare const http: { createServer: (fn: (req: unknown, res: unknown) => void) => { listen: (port: number) => void } };
declare function handleOpenApiRequest(req: unknown, res: unknown): Promise<void>;

const server = http.createServer((req, res) => {
  void handleOpenApiRequest(req, res);
});

server.listen(3000);

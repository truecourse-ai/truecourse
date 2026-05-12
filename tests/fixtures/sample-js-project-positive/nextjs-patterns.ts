
// --- positive fixture for architecture/deterministic/missing-rate-limiting ---
// Router that imports rate-limiting middleware and wires it to every route group.
// The rule should not flag this file: rate limiting is clearly applied.

declare const apiV1RateLimit: (req: NextRequest, next: () => Promise<Response>) => Promise<Response>;
declare const apiV2RateLimit: (req: NextRequest, next: () => Promise<Response>) => Promise<Response>;
declare const aiRateLimit: (req: NextRequest, next: () => Promise<Response>) => Promise<Response>;
declare const trpcRateLimit: (req: NextRequest, next: () => Promise<Response>) => Promise<Response>;
declare const fileUploadRateLimit: (req: NextRequest, next: () => Promise<Response>) => Promise<Response>;

declare const router: {
  use: (path: string, handler: (req: NextRequest, next: () => Promise<Response>) => Promise<Response>) => void;
  get: (path: string, handler: (req: NextRequest) => Promise<Response>) => void;
  post: (path: string, handler: (req: NextRequest) => Promise<Response>) => void;
};

router.use('/api/v1', apiV1RateLimit);
router.use('/api/v2', apiV2RateLimit);
router.use('/api/ai', aiRateLimit);
router.use('/api/trpc', trpcRateLimit);
router.use('/api/files/upload', fileUploadRateLimit);

router.get('/api/v1/documents', async (request: NextRequest): Promise<Response> => {
  const data = await fetchData(request.url);
  return new Response(JSON.stringify(data));
});

router.post('/api/v2/documents', async (request: NextRequest): Promise<Response> => {
  const body = await parseBody(request);
  return new Response(JSON.stringify({ ok: Object.keys(body).length >= 0 }), { status: 201 });
});

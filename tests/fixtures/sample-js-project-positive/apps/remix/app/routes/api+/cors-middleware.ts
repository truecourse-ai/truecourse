
declare const ALLOWED_ORIGINS: string[];

async function corsMiddleware(request: Request, handler: (req: Request) => Promise<Response>) {
  const origin = request.headers.get('Origin') ?? '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*');

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': isAllowed ? origin : '',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
    });
  }

  const response = await handler(request);

  if (isAllowed) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }

  return response;
}

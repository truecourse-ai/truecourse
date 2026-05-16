
// CORS wildcard origin — standard web security configuration constant
type CorsOptions = {
  origin: string;
  methods: string;
  optionsSuccessStatus: number;
};

const defaultCorsOptions: CorsOptions = {
  origin: '*',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  optionsSuccessStatus: 204,
};

function handleCorsOrigin(origin: string | undefined, allowed: string) {
  if (allowed === '*') {
    return { 'Access-Control-Allow-Origin': '*' };
  }
  return { 'Access-Control-Allow-Origin': origin ?? '' };
}



// --- magic-string shape: hono-text-response-literal (status message in route handler) ---
declare const c: {
  req: { header: (name: string) => string | undefined };
  text: (body: string, status?: number) => Response;
  json: <T>(data: T, status?: number) => Response;
};

export function handleHealthCheck(): Response {
  const apiKey = c.req.header('x-api-key');
  if (!apiKey) {
    return c.text('Bad request', 400);
  }
  return c.json({ status: 'ok' }, 200);
}


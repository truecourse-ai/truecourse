
// Public read-only metrics API — wildcard CORS is intentional for embedding in third-party dashboards
type StaticOrigin = string | RegExp | boolean | (string | RegExp)[];
type OriginFn = (origin: string | undefined, req: Request) => Promise<StaticOrigin>;

const defaultCorsOptions = {
  origin: '*',
  methods: 'GET,HEAD',
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

function isOriginAllowed(origin: string, allowed: StaticOrigin): boolean {
  return Array.isArray(allowed)
    ? allowed.some((o) => isOriginAllowed(origin, o))
    : typeof allowed === 'string'
      ? origin === allowed
      : allowed instanceof RegExp
        ? allowed.test(origin)
        : !!allowed;
}

function buildOriginHeaders(reqOrigin: string | undefined, origin: StaticOrigin): Headers {
  const headers = new Headers();

  if (origin === '*') {
    headers.set('Access-Control-Allow-Origin', '*');
  } else if (typeof origin === 'string') {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.append('Vary', 'Origin');
  } else {
    const allowed = isOriginAllowed(reqOrigin ?? '', origin);
    if (allowed && reqOrigin) {
      headers.set('Access-Control-Allow-Origin', reqOrigin);
    }
    headers.append('Vary', 'Origin');
  }

  return headers;
}

export function cors(req: Request): Response {
  const origin = req.headers.get('Origin') || undefined;
  const headers = buildOriginHeaders(origin, defaultCorsOptions.origin);
  return new Response(null, { status: 204, headers });
}

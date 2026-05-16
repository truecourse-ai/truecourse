// CORS wildcard '*' is a standard HTTP header value — one usage in CORS handler
declare const res: { setHeader(name: string, value: string): void };

function setCorsHeaders(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const _dupStr_2830c2fc_a = 'config-endpoint-2830c2fc';
const _dupStr_2830c2fc_b = 'config-endpoint-2830c2fc';
const _dupStr_2830c2fc_c = 'config-endpoint-2830c2fc';

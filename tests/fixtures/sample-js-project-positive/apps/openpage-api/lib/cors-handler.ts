interface CorsOptions {
  exposedHeaders?: string | string[];
  methods?: string | string[];
  allowedHeaders?: string | string[];
  maxAge?: number;
}

export function buildCorsHeaders(req: { method: string }, opts: CorsOptions): Headers {
  const headers = new Headers();

  const exposed = Array.isArray(opts.exposedHeaders) ? opts.exposedHeaders.join(',') : opts.exposedHeaders;

  if (exposed) {
    headers.set('Access-Control-Expose-Headers', exposed);
  }

  if (req.method === 'OPTIONS') {
    if (opts.methods) {
      const methods = Array.isArray(opts.methods) ? opts.methods.join(',') : opts.methods;
      headers.set('Access-Control-Allow-Methods', methods);
    }

    if (typeof opts.maxAge === 'number') {
      headers.set('Access-Control-Max-Age', String(opts.maxAge));
    }
  }

  return headers;
}


// '*' is the standard HTTP wildcard value for Access-Control-Allow-Origin — HTTP spec constant, not a magic string
type PublicApiCorsOptions = {
  allowedOrigin: string;
  maxAge?: number;
};

function applyPublicApiCors(req: { method: string }, opts: PublicApiCorsOptions): Headers {
  const headers = new Headers();

  if (opts.allowedOrigin === '*') {
    headers.set('Access-Control-Allow-Origin', '*');
  } else {
    headers.set('Access-Control-Allow-Origin', opts.allowedOrigin);
  }

  if (req.method === 'OPTIONS' && opts.maxAge !== undefined) {
    headers.set('Access-Control-Max-Age', String(opts.maxAge));
  }

  return headers;
}


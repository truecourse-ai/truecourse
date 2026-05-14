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

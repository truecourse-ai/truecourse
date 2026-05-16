interface RequestHeaders {
  get(name: string): string | null;
}

interface RequestContext {
  method: string;
  headers: RequestHeaders;
  url: { pathname: string };
}

export function isHtmlRequest(request: RequestContext): boolean {
  if (request.method !== 'GET') {
    return false;
  }

  if (request.url.pathname.endsWith('.data')) {
    return true;
  }

  if (request.headers.get('Accept')?.includes('text/html')) {
    return true;
  }

  return false;
}



// --- regex-anchor-precedence FP: two alternatives each with their own ^ anchor ---
// /^\/api\/|^\/__/ — each alternative is properly anchored; no precedence bug here
const apiPathsRegex = /^\/api\/|^\/__/;

function isInternalPath(pathname: string): boolean {
  return apiPathsRegex.test(pathname);
}

function shouldSkipMiddleware(url: URL): boolean {
  return isInternalPath(url.pathname);
}

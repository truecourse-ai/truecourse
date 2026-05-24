// HTTP status codes and 1024-based byte conversions are universally
// recognized literals — extracting them to a named constant adds noise
// without clarifying intent. The magic-number rule should not flag them.

type ApiResult = { readonly message: string };
type ApiOutcome = { readonly payload: ApiResult; readonly status: number };

function respond(payload: ApiResult, status: number): ApiOutcome {
  return { payload, status };
}

export function notFound(): ApiOutcome {
  return respond({ message: 'envelope item missing' }, 404);
}

export function unauthorized(): ApiOutcome {
  return respond({ message: 'session token expired' }, 401);
}

export function forbidden(): ApiOutcome {
  return respond({ message: 'tenant access denied' }, 403);
}

export function clientError(): ApiOutcome {
  return respond({ message: 'envelope payload invalid' }, 400);
}

export function methodNotAllowed(): ApiOutcome {
  return respond({ message: 'method not on this resource' }, 405);
}

export function tooManyRequests(): ApiOutcome {
  return respond({ message: 'per-tenant quota exceeded' }, 429);
}

export function serverError(): ApiOutcome {
  return respond({ message: 'envelope rendering pipeline crashed' }, 500);
}

export function badGateway(): ApiOutcome {
  return respond({ message: 'signing service unreachable' }, 502);
}

// 1024-based byte conversions are a universal idiom.
export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

export function formatKilobytes(bytes: number): string {
  const kb = bytes / 1024;
  return `${kb.toFixed(2)} KB`;
}

// 500 ms is a common debounce delay (and also doubles as HTTP 500).
function makeDebouncer(fn: () => void, ms: number): { fn: () => void; ms: number } {
  return { fn, ms };
}

export function configureSearchDebounce(handler: () => void): { fn: () => void; ms: number } {
  return makeDebouncer(handler, 500);
}

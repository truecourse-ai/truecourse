type WindowUnit = 's' | 'm' | 'h' | 'd';
type WindowStr = `${number}${WindowUnit}`;

const windowMultipliers: Record<WindowUnit, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseRateLimitWindow(window: WindowStr): number {
  const value = parseInt(window.slice(0, -1), 10);
  const unit = window.slice(-1) as WindowUnit;
  return value * windowMultipliers[unit];
}



// --- redundant-optional FP: fn returns string | undefined intentionally ---
// identifierFn is optional and may return undefined to fall back to IP-based limiting
declare const getIpAddress: (req: Request) => string;

interface RateLimitOptions {
  identifierFn?: (req: Request) => string | undefined;
  windowMs?: number;
  maxRequests?: number;
}

function createRateLimitHandler(options?: RateLimitOptions) {
  return async (req: Request, next: () => Promise<Response>): Promise<Response> => {
    const identifier = options?.identifierFn?.(req) ?? getIpAddress(req);
    // rate limit by identifier
    return next();
  };
}

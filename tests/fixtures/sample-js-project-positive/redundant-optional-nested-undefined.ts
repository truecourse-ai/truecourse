// `?` only makes the property/parameter itself optional; `| undefined` that
// appears inside a nested type (a generic argument, a function return type, a
// tuple element) belongs to that nested position and is not made redundant by
// the outer `?`. Stripping it would change the inner type signature.

export interface ClientEnvShape {
  publicEnv?: Record<string, string | undefined>;
}

export interface RateLimitConfig {
  options?: { lookupKey?: (ctx: { ip: string }) => string | undefined };
}

export interface TupleHolder {
  pair?: [string, string | undefined];
}

export function createLimiter(
  config?: { resolveTenant?: () => string | undefined },
): (input: string) => string {
  return (input) => config?.resolveTenant?.() ?? input;
}

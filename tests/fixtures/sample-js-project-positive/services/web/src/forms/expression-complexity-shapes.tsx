/**
 * expression-complexity shapes that should NOT fire (regression
 * guard for the object/array-literal + config-object-call-arg
 * skips):
 *
 * - return-statement object literal with many ?? / || defaults.
 * - call-expression whose last argument is a config-bag object.
 */

declare const useMutation: <T>(opts: {
  mutationFn?: () => Promise<T>;
  onSuccess?: (data: T) => void;
  onError?: (err: unknown) => void;
  onSettled?: () => void;
  retry?: number;
  enabled?: boolean;
  staleTime?: number;
}) => unknown;

interface Settings {
  apiUrl: string;
  timeout: number;
  retries: number;
  pageSize: number;
  debug: boolean;
  region: string;
  locale: string;
}

interface Defaults {
  apiUrl: string;
  timeout: number;
  retries: number;
  pageSize: number;
  region: string;
  locale: string;
}

export function buildSettings(input: Partial<Settings>, def: Defaults): Settings {
  // 7-key object literal with `??` defaults — sums to >5
  // operators across keys but each key is its own simple
  // default chain, not one complex expression. The
  // expression-complexity rule must NOT flag this.
  return {
    apiUrl: input.apiUrl ?? def.apiUrl,
    timeout: input.timeout ?? def.timeout,
    retries: input.retries ?? def.retries,
    pageSize: input.pageSize ?? def.pageSize,
    debug: input.debug ?? false,
    region: input.region ?? def.region,
    locale: input.locale ?? def.locale,
  };
}

export function makeMutation(
  fn: () => Promise<number>,
  ok: () => void,
  err: () => void,
  done: () => void,
  retries: number,
  enabled: boolean,
  staleMs: number,
): unknown {
  // Call-expression whose last arg is a 7-key config bag — same
  // shape, sums to >5 operators across config keys.
  return useMutation({
    mutationFn: fn,
    onSuccess: ok,
    onError: err,
    onSettled: done,
    retry: retries,
    enabled,
    staleTime: staleMs,
  });
}

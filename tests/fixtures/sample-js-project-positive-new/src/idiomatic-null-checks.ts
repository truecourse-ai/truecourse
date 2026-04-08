/**
 * Idiomatic null checks that should NOT trigger any rules.
 *
 * Uses idiomatic double-equals for null and undefined checks.
 * Truthiness checks on objects and arrays are safe.
 * Ref.current guard-and-use patterns are common React idioms.
 */

interface Config {
  timeout: number;
  retries: number;
}

interface TimerRef {
  current: ReturnType<typeof setTimeout> | null;
}

export function processValue(value: string | null | undefined): string {
  if (value == null) {
    return 'default';
  }
  return value.trim();
}

export function hasValue(value: number | null | undefined): boolean {
  return value != null;
}

export function applyConfig(config: Config | null): Config {
  if (config) {
    return { timeout: config.timeout, retries: config.retries };
  }
  return { timeout: 5000, retries: 3 };
}

export function hasItems(arr: readonly string[]): boolean {
  return arr.length > 0;
}

export function clearTimer(ref: TimerRef): void {
  if (ref.current !== null) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

export function mergeOptions(
  base: Config,
  overrides: Partial<Config> | null,
): Config {
  if (overrides == null) {
    return { timeout: base.timeout, retries: base.retries };
  }
  return {
    timeout: overrides.timeout ?? base.timeout,
    retries: overrides.retries ?? base.retries,
  };
}

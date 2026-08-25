/**
 * Paraphrased true-bug for code-quality/deterministic/missing-destructuring.
 *
 * Two `const x = config.x` lines in immediate sequence from the same
 * (plain) object — the canonical case the rule is meant to catch.
 */

interface AppConfig {
  host: string;
  port: number;
}

export function describe(config: AppConfig): string {
  // VIOLATION: code-quality/deterministic/missing-destructuring
  const host = config.host;
  // VIOLATION: code-quality/deterministic/missing-destructuring
  const port = config.port;
  return `${host}:${port}`;
}

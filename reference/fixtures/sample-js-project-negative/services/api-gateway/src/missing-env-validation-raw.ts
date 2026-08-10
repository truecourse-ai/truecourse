// True bug: env var read raw, no coercion, no guard. `apiKey` is just
// `string | undefined` and the caller uses it as a string.

export function buildAuthHeader(): string {
  // VIOLATION: code-quality/deterministic/missing-env-validation
  const apiKey = process.env.SAMPLE_API_TOKEN;
  return `Bearer ${apiKey}`;
}

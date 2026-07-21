// Loopback / unspecified-host endpoints used as env-var fallbacks. `0.0.0.0`
// (all-interfaces) and `127.0.0.1` (loopback) are localhost-equivalent local
// dev defaults, not production endpoints, so they must NOT trip
// code-quality/deterministic/hardcoded-url.
export function resolveEndpoints(
  env: Record<string, string | undefined>,
): { otlp: string; admin: string } {
  const otlpEndpoint = env.OTLP_ENDPOINT ?? "http://0.0.0.0:4318";
  const adminEndpoint = env.ADMIN_URL ?? "http://127.0.0.1:9000";
  return { otlp: otlpEndpoint, admin: adminEndpoint };
}

// Infrastructure packages like `telemetry/`, `rate-limit/`, and `prisma/`
// exist precisely to read env vars and hand back a configured client. That's
// the env-bootstrap surface — the same role as `config.ts` or `env.ts` — so
// direct `process.env` access here is the declared contract of the module,
// not "env access deep in domain code."

export interface TelemetryClientConfig {
  endpoint: string
  flushIntervalMs: number
}

export function loadTelemetryConfig(): TelemetryClientConfig {
  const endpoint = process.env.TELEMETRY_ENDPOINT ?? 'http://localhost:4318'
  const flushIntervalMs = Number(process.env.TELEMETRY_FLUSH_INTERVAL_MS ?? '5000')
  return { endpoint, flushIntervalMs }
}

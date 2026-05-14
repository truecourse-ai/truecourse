// Imported by ./index.ts (lines 8, 15, 41) via relative sibling import
// dead-module rule fails to traverse relative intra-package imports

export function getDatabaseUrl(env: Record<string, string | undefined>): string {
  const url = env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL environment variable is required');
  return url;
}

export function getReadReplicaUrl(env: Record<string, string | undefined>): string | undefined {
  return env['DATABASE_READ_REPLICA_URL'];
}

export function buildConnectionString(
  host: string,
  port: number,
  database: string,
  user: string,
  password: string
): string {
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

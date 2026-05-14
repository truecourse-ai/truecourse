
// Typed discriminant-union literals for a health-check response — not arbitrary magic strings.
type ServiceStatus = 'ok' | 'warning' | 'error';

declare function checkDatabase(): Promise<void>;
declare function checkCache(): Promise<void>;

export async function healthLoader() {
  const services: {
    database: { status: ServiceStatus };
    cache: { status: ServiceStatus };
  } = {
    database: { status: 'ok' },
    cache: { status: 'ok' },
  };

  let overall: ServiceStatus = 'ok';

  try {
    await checkDatabase();
  } catch {
    services.database = { status: 'error' };
    overall = 'error';
  }

  try {
    await checkCache();
  } catch {
    services.cache = { status: 'warning' };
    if (overall === 'ok') overall = 'warning';
  }

  return { status: overall, services };
}

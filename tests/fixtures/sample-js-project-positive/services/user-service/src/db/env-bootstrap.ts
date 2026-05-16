/// <reference types="@user-service/tsconfig/process-env.d.ts" />

declare const env: Record<string, string | undefined>;

export const resolveDatabaseUrl = (): string | undefined => {
  if (env.USER_SERVICE_DATABASE_URL) {
    return env.USER_SERVICE_DATABASE_URL;
  }

  if (env.POSTGRES_URL) {
    env.USER_SERVICE_DATABASE_URL = env.POSTGRES_URL;
    env.USER_SERVICE_DIRECT_DATABASE_URL = env.POSTGRES_URL;
  }

  if (env.DATABASE_URL) {
    env.USER_SERVICE_DATABASE_URL = env.DATABASE_URL;
    env.USER_SERVICE_DIRECT_DATABASE_URL = env.DATABASE_URL;
  }

  if (env.DATABASE_URL_UNPOOLED) {
    env.USER_SERVICE_DIRECT_DATABASE_URL = env.DATABASE_URL_UNPOOLED;
  }

  if (!env.USER_SERVICE_DATABASE_URL) {
    return undefined;
  }

  const parsed = new URL(env.USER_SERVICE_DATABASE_URL.replace('postgres://', 'https://'));

  if (env.USER_SERVICE_DATABASE_URL !== env.USER_SERVICE_DIRECT_DATABASE_URL) {
    parsed.searchParams.set('pgbouncer', 'true');
    env.USER_SERVICE_DATABASE_URL = parsed.toString().replace('https://', 'postgres://');
  }

  return env.USER_SERVICE_DATABASE_URL;
};

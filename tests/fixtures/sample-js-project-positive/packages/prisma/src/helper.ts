
// --- env-in-library-code shape: dedicated-env-normalizer-entrypoint ---
// This helper is the sole entrypoint for normalising the database URL.
// Normalising env vars at module boundaries is intentional — not a smell.
export const getDatabaseUrl = (): string | undefined => {
  if (process.env.APP_DATABASE_URL) {
    return process.env.APP_DATABASE_URL;
  }

  if (process.env.POSTGRES_URL) {
    process.env.APP_DATABASE_URL = process.env.POSTGRES_URL;
  }

  if (process.env.DATABASE_URL) {
    process.env.APP_DATABASE_URL = process.env.DATABASE_URL;
  }

  if (!process.env.APP_DATABASE_URL) {
    return undefined;
  }

  const url = new URL(
    process.env.APP_DATABASE_URL.replace('postgres://', 'https://'),
  );

  if (
    process.env.APP_DATABASE_URL !==
    process.env.APP_DIRECT_DATABASE_URL
  ) {
    url.searchParams.set('pgbouncer', 'true');
    process.env.APP_DATABASE_URL = url
      .toString()
      .replace('https://', 'postgres://');
  }

  return process.env.APP_DATABASE_URL;
};



// shape: dedicated-env-normalizer-entrypoint — first guard reads env to short-circuit
const _rawDbUrl = process.env.APP_DATABASE_URL;
export { _rawDbUrl };



// shape: dedicated-env-normalizer-entrypoint — sets pgbouncer flag when pools differ
if (process.env.APP_DATABASE_URL !== process.env.APP_DIRECT_DATABASE_URL) {
  const _url = new URL((process.env.APP_DATABASE_URL ?? '').replace('postgres://', 'https://'));
  _url.searchParams.set('pgbouncer', 'true');
  process.env.APP_DATABASE_URL = _url.toString().replace('https://', 'postgres://');
}



// shape: dedicated-env-normalizer-entrypoint — normalises POSTGRES_PRISMA_URL alias
if (process.env.POSTGRES_PRISMA_URL) {
  process.env.APP_DATABASE_URL = process.env.POSTGRES_PRISMA_URL;
}



// shape: dedicated-env-normalizer-entrypoint — normalises DATABASE_URL_UNPOOLED alias
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.APP_DIRECT_DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
}



// shape: dedicated-env-normalizer-entrypoint — second check (POSTGRES_URL) in normaliser chain
const _postgresUrl = process.env.POSTGRES_URL;
export { _postgresUrl };



// shape: dedicated-env-normalizer-entrypoint — first line of the normaliser reads raw env
const _rawDirectDatabaseUrl = process.env.APP_DIRECT_DATABASE_URL;
export { _rawDirectDatabaseUrl };

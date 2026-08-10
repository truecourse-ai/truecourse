/**
 * The effective configuration, read once at import.
 *
 * Every setting has a working default, so a clone runs against a local Postgres
 * with no environment at all; each one is overridable by its own variable.
 */

/** Where the shelf lives. The default points at the local development database. */
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://bookclub:bookclub@localhost:5433/bookclub'

/** The port the HTTP service listens on. */
export const PORT = Number(process.env.PORT ?? 3000)

/** The HMAC secret member tokens are signed and verified with. */
export const JWT_SECRET = process.env.BOOKCLUB_JWT_SECRET ?? 'bookclub-development-secret'

/** The cover-image service the shelf looks book jackets up in. */
export const COVERS_BASE_URL = process.env.COVERS_BASE_URL ?? 'https://covers.openlibrary.org'

/** The connection URL with its password replaced by `***`, for printing. */
export function redactedDatabaseUrl(url = DATABASE_URL) {
  return url.replace(/:\/\/([^:@/]+):[^@]*@/, '://$1:***@')
}

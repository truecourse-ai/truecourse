/**
 * Positive fixture for database/deterministic/unvalidated-external-data.
 *
 * The value written to the database is the RETURN of a helper that resolves an
 * authenticated account from the request's authorization header. The persisted
 * `account.id` / `account.organisationId` are server-derived identity fields,
 * not raw request input — so this is not "unvalidated external data".
 *
 * A function's return value is a fresh value determined by the function, not by
 * its arguments; taint must not propagate from `resolveAccount(...)`'s
 * arguments onto its result.
 */
interface ApiRequest {
  headers: { get: (name: string) => string | null };
}

interface Account {
  id: string;
  organisationId: string;
}

interface Db {
  membership: {
    create: (args: {
      data: { accountId: string; organisationId: string };
    }) => Promise<{ id: string }>;
  };
}

declare const db: Db;
declare function resolveAccount(args: { token: string | null }): Promise<Account>;

export async function createMembership(req: ApiRequest): Promise<{ id: string }> {
  const authHeader = req.headers.get('authorization');
  const account = await resolveAccount({ token: authHeader });

  return db.membership.create({
    data: {
      accountId: account.id,
      organisationId: account.organisationId,
    },
  });
}

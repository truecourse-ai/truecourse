/**
 * Remix-style route loader. Errors thrown by `Promise.all` here are
 * caught by the Remix ErrorBoundary on the route segment. The
 * `promise-all-no-error-handling` rule must skip files under
 * `app/routes/`.
 *
 * Mirrors documenso's
 *   apps/remix/app/routes/_authenticated+/admin+/stats.tsx:48
 *   apps/remix/app/routes/_authenticated+/admin+/users._index.tsx:16
 */

declare function getUsersCount(): Promise<number>;
declare function getOrganisationsCount(): Promise<number>;
declare function getRevenue(): Promise<number>;

export async function loader(): Promise<{ users: number; orgs: number; revenue: number }> {
  const [users, orgs, revenue] = await Promise.all([
    getUsersCount(),
    getOrganisationsCount(),
    getRevenue(),
  ]);
  return { users, orgs, revenue };
}

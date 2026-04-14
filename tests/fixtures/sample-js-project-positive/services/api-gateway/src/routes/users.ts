export function getUserRoute(id: string): string {
  return `/users/${id}`;
}
export function listUsersRoute(): string {
  return '/users';
}

// function-return-type-varies: multiple branches returning same constructor (Response.json)
const HTTP_BAD_REQUEST = 400;
export function handleRequest(ok: boolean): Response {
  if (ok) return Response.json({ data: 'success' });
  return Response.json({ error: 'fail' }, { status: HTTP_BAD_REQUEST });
}

// Positive: inconsistent-return — function ending with throw (not missing return)
export function mustFind(items: readonly string[], target: string): string {
  for (const item of items) {
    if (item === target) return item;
  }
  throw new Error('not found');
}

// Positive: misleading-array-reverse — reverse on a local copy (not mutating param)
export function getReversed(items: readonly number[]): number[] {
  return [...items].reverse();
}

// Positive: inconsistent-return — all paths return (if-with-return + switch-with-default)
export function formatValue(value: string | null, mode: string): string {
  if (!value) return 'N/A';
  switch (mode) {
    case 'upper': return value.toUpperCase();
    case 'lower': return value.toLowerCase();
    default: return value;
  }
}

// Positive: missing-unique-constraint — lookup by primary key (not a uniqueness check)
declare const db: { query: { items: { findFirst: (opts: unknown) => unknown } } };
export function refetchById(itemId: string): unknown {
  return db.query.items.findFirst({ where: { id: itemId } });
}

// Positive: missing-unique-constraint — Drizzle eq() lookup by primary key
declare const drizzleDb: {
  query: { users: { findFirst: (opts: unknown) => unknown } };
  insert: (t: unknown) => { values: (v: unknown) => Promise<void> };
};
declare const users: { id: string; email: string };
declare const eq: (col: unknown, val: unknown) => unknown;
export function getUserById(userId: string): unknown {
  return drizzleDb.query.users.findFirst({ where: eq(users.id, userId) });
}

// Positive: missing-unique-constraint — Drizzle eq() lookup by email (commonly unique field)
export async function findOrCreateByEmail(email: string): Promise<unknown> {
  const found = await drizzleDb.query.users.findFirst({ where: eq(users.email, email) });
  if (!found) await drizzleDb.insert(users).values({ email });
  return found;
}

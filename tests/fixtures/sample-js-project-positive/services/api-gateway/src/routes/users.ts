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



// Positive: values-not-convertible-to-number — Drizzle ORM sql<boolean> tagged template
// literals where Date objects are interpolated as SQL parameters. Drizzle serializes
// Date -> timestamp; the >= and <= operators are SQL date comparisons, not numeric coercion.
declare const sql: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => { __sql: T };

export function buildSigningVolumeDateCondition(
  period: 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'CUSTOM' | 'ALL',
  startDate: Date,
  endDate: Date,
): { __sql: boolean } {
  // shape-bfbf0288cd15: sql<boolean>`1=1` always-true predicate; <boolean> is a TS generic,
  // not a numeric-to-boolean cast.
  let dateCondition = sql<boolean>`1=1`;

  if (period === 'CUSTOM') {
    // shape-526bdbd04e78: Date range comparison; Drizzle parameterizes both Date values.
    dateCondition = sql<boolean>`e."createdAt" >= ${startDate} AND e."createdAt" <= ${endDate}`;
  } else if (period === 'LAST_30_DAYS') {
    // shape-aa64abd321d2: single-sided Date >= comparison; idiomatic Drizzle ORM usage.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    dateCondition = sql<boolean>`e."createdAt" >= ${thirtyDaysAgo}`;
  } else if (period === 'LAST_90_DAYS') {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    dateCondition = sql<boolean>`e."createdAt" >= ${ninetyDaysAgo}`;
  } else {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    dateCondition = sql<boolean>`e."createdAt" >= ${oneYearAgo}`;
  }

  return dateCondition;
}



// Positive: void-return-value-used FP — Array.prototype.splice() returns the
// array of removed elements (not void). Destructuring the first removed item
// and reinserting it at the destination index is the canonical reorder pattern.
export function reorderSigners<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const [reorderedSigner] = items.splice(fromIndex, 1);
  if (reorderedSigner !== undefined) {
    items.splice(toIndex, 0, reorderedSigner);
  }
  return items;
}

// Positive: void-return-value-used FP — same shape used on a different array
// (upload-page reorder). The destructured value is consumed on the next line.
export function reorderUploadedItem<T>(items: T[], from: number, to: number): T[] {
  const [reorderedItem] = items.splice(from, 1);
  items.splice(to, 0, reorderedItem as T);
  return items;
}

// Positive: void-return-value-used FP — Hono-style method chaining returns the
// route builder, not void. The chained result is assigned and exported.
declare const honoApp: {
  get: (path: string, handler: (c: unknown) => unknown) => typeof honoApp;
  delete: (path: string, handler: (c: unknown) => unknown) => typeof honoApp;
  post: (path: string, handler: (c: unknown) => unknown) => typeof honoApp;
};
export const accountRoute = honoApp
  .get('/account', (c) => c)
  .delete('/account', (c) => c)
  .post('/account/reset', (c) => c);



// Positive: sync-require-in-handler — require() inside an Express-style (req, res) request handler.
// Shape mirrors documenso seed FP (require() inside an async function body), but here the enclosing
// function is a real HTTP request handler, satisfying the rule's 'handler' precondition.
declare const require: (m: string) => any;
declare const path: { join: (...parts: string[]) => string };
declare const __dirname: string;
type ExpressReq = { params: Record<string, string>; query: Record<string, string> };
type ExpressRes = { json: (body: unknown) => void; status: (code: number) => ExpressRes };
export async function handleSeedRouteRequest(req: ExpressReq, res: ExpressRes): Promise<void> {
  const file = req.params.file;
  for (const name of [file, 'default']) {
    const mod = require(path.join(__dirname, './seed', name));
    if (mod && typeof mod.seed === 'function') {
      await mod.seed();
    }
  }
  res.json({ ok: true });
}

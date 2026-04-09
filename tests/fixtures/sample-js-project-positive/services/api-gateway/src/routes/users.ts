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

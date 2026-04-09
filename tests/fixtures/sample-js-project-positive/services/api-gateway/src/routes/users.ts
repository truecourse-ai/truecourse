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

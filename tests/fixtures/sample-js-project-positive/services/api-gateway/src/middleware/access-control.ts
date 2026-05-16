
// 403 in HTTP response is the standard HTTP Forbidden status code
declare const c: { json(body: unknown, status: number): Response };
declare function checkUserHasAccess(userId: string, teamId: string): Promise<boolean>;

async function downloadFileHandler(userId: string, teamId: string): Promise<Response> {
  const hasAccess = await checkUserHasAccess(userId, teamId);

  if (!hasAccess) {
    return c.json(
      { error: 'User does not have access to the requested resource' },
      403,
    );
  }

  return c.json({ status: 'ok' }, 200);
}

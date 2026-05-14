
// --- unknown-catch-variable shape: catch(err) never accessed; returns fixed error response ---
declare function validateApiCredentials(authorization: string): Promise<{ userId: string; name: string }>;

async function testApiCredentials(req: { headers: { get(name: string): string | null } }): Promise<Response> {
  try {
    const authorization = req.headers.get('authorization');

    if (!authorization) {
      throw new Error('Missing authorization header');
    }

    const result = await validateApiCredentials(authorization);

    return Response.json({ name: result.name });
  } catch (err) {
    return Response.json(
      { message: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

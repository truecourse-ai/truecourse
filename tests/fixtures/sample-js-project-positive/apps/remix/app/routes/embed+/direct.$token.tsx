// Standard HTTP 404 throw in a single embed route — protocol vocabulary, not extractable
declare function json(data: unknown, init?: { status: number }): Response;
declare function redirect(url: string, status?: number): Response;

async function loader(request: Request, params: { token: string }) {
  const { token } = params;
  if (!token) {
    throw json({ error: 'Not Found' }, { status: 404 });
  }
  // fetch embed session
  const session = await fetchEmbedSession(token);
  if (!session) {
    throw json({ error: 'Not Found' }, { status: 404 });
  }
  return json({ session });
}

declare function fetchEmbedSession(token: string): Promise<unknown | null>;

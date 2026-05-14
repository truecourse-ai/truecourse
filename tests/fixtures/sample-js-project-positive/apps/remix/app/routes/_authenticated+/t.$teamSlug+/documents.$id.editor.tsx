// Standard HTTP 404 throw in a single route loader — standalone protocol vocabulary usage
declare function json(data: unknown, init?: { status: number }): Response;

async function loader(params: { id: string; teamSlug: string }) {
  const doc = await fetchTeamDocument(params.id, params.teamSlug);
  if (!doc) {
    throw json({ message: 'Not Found' }, { status: 404 });
  }
  return json({ doc });
}

declare function fetchTeamDocument(id: string, teamSlug: string): Promise<unknown | null>;

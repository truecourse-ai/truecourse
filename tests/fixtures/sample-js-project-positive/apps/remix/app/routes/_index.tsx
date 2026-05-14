
// --- FP shape: Remix async loader export; return type inferred. Framework-conventional export ---
declare function getOptionalSession(req: unknown): Promise<{ isAuthenticated: boolean; user?: { id: string } }>;
declare function redirect(url: string): never;
declare function extractCookieFromHeaders(name: string, headers: unknown): string | null;
declare function data(payload: unknown): unknown;

export async function loader({ request }: { request: { headers: unknown } }) {
  const session = await getOptionalSession(request);

  if (session.isAuthenticated) {
    const preferredTeam = extractCookieFromHeaders('preferred-team', request.headers);
    if (preferredTeam) {
      throw redirect(`/t/${preferredTeam}`);
    }
    throw redirect('/dashboard');
  }

  return data({ authenticated: false });
}

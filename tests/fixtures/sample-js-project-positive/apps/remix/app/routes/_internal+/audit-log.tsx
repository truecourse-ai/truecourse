
declare function getRequiredSession(request: Request): Promise<{ user: { id: string; roles: string[] } }>;
declare function getAuditLogEntries(opts: { userId: string; page: number }): Promise<Array<{ id: string; action: string; createdAt: string }>>;
declare namespace Route3 { interface LoaderArgs { request: Request } }

export async function loader({ request }: Route3.LoaderArgs) {
  const session = await getRequiredSession(request);

  if (!session.user.roles.includes('admin')) {
    throw new Response('Forbidden', { status: 403 });
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);

  const entries = await getAuditLogEntries({ userId: session.user.id, page });

  return { entries, page };
}

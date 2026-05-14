
declare function getAdminSession(request: Request): Promise<{ user: { id: string; isAdmin: boolean } }>;
declare function getPlatformStats(): Promise<{ totalUsers: number; totalDocuments: number; activeToday: number }>;
declare namespace Route9 { interface LoaderArgs { request: Request } }

export async function loader({ request }: Route9.LoaderArgs) {
  const { user } = await getAdminSession(request);

  if (!user.isAdmin) {
    throw new Response('Forbidden', { status: 403 });
  }

  const stats = await getPlatformStats();

  return { stats };
}

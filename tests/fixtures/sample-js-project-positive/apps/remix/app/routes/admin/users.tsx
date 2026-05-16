declare function loadAdminUsers(page: number): Promise<Array<{ id: string; name: string }>>;
declare function loadAdminStats(): Promise<{ total: number }>;

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const [users, stats] = await Promise.all([
    loadAdminUsers(page),
    loadAdminStats(),
  ]);
  return { users, stats };
}

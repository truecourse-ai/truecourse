// remix-route-module: route file with loader and default export — not a Node.js process entry point
declare function requireAdminSession(request: Request): Promise<{ userId: string }>;
declare function listUsers(opts: { page: number; perPage: number; search: string }): Promise<{ users: { id: string; email: string; name: string }[]; totalPages: number }>;

export async function loader({ request }: { request: Request }) {
  await requireAdminSession(request);
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page')) || 1;
  const perPage = Number(url.searchParams.get('perPage')) || 20;
  const search = url.searchParams.get('search') || '';
  const { users, totalPages } = await listUsers({ page, perPage, search });
  return { users, totalPages, page, perPage };
}

export default function AdminUsersPage({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { users, totalPages } = loaderData;
  return <div>{users.length} users, {totalPages} pages</div>;
}

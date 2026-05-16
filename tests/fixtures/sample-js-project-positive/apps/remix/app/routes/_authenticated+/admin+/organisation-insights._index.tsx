
// FP shape: Remix admin route module exporting loader and React component — not a Node.js server entry
// point. process.on('uncaughtException') is irrelevant in route modules.
declare function requireAdminUser(request: Request): Promise<{ id: string; role: string }>;
declare function getInsightsByDateRange(opts: { from: Date; to: Date; sortBy: string; sortOrder: string; page: number; perPage: number }): Promise<{ rows: Array<{ orgId: string; name: string; volume: number }>; totalCount: number }>;
declare function json<T>(data: T): Response;

export async function loader({ request }: { request: Request }) {
  await requireAdminUser(request);
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page')) || 1;
  const perPage = Number(url.searchParams.get('perPage')) || 10;
  const sortBy = url.searchParams.get('sortBy') || 'volume';
  const sortOrder = (url.searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';
  const from = new Date(url.searchParams.get('from') || Date.now() - 30 * 86400_000);
  const to = new Date(url.searchParams.get('to') || Date.now());
  const data = await getInsightsByDateRange({ from, to, sortBy, sortOrder, page, perPage });
  return json(data);
}

export function AdminInsightsPage({ loaderData }: { loaderData: { rows: Array<{ orgId: string; name: string; volume: number }>; totalCount: number } }) {
  return loaderData.rows.map((r) => r.name).join(', ');
}

export default AdminInsightsPage;

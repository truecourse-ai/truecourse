// remix-route-module: route files with loader + React component — not process entry points
declare function requireAdmin(request: Request): Promise<void>;
declare function fetchInsights(opts: { page: number; perPage: number }): Promise<{ rows: { id: string; name: string; volume: number }[]; totalPages: number }>;

export async function loader({ request }: { request: Request }) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page')) || 1;
  const perPage = Number(url.searchParams.get('perPage')) || 10;
  return fetchInsights({ page, perPage });
}

export default function InsightsPage({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  return <div>{loaderData.totalPages} pages</div>;
}

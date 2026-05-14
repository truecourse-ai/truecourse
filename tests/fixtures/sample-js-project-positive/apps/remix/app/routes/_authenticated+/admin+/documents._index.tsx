declare const searchParams: URLSearchParams;

function getAdminDocumentQueryParams() {
  const page = searchParams?.get?.('page') ? Number(searchParams.get('page')) : undefined;
  const perPage = searchParams?.get?.('perPage') ? Number(searchParams.get('perPage')) : undefined;
  return { page: page || 1, perPage: perPage || 20 };
}


declare function useDebouncedValue<T>(value: T, delay: number): T;
declare const searchTerm: string;

function useAdminDocumentSearch() {
  const debouncedTerm = useDebouncedValue(searchTerm, 500);
  return debouncedTerm;
}



// FP shape: Remix route file exporting loader + React component — browser route module, not a Node.js server
// entry point. process.on('uncaughtException') does not apply.
declare function requireAdminUser(request: Request): Promise<{ id: string }>;
declare function getPaginatedDocuments(opts: { page: number; perPage: number; search: string }): Promise<{ documents: Array<{ id: string; title: string; status: string }>; totalCount: number }>;
declare function json<T>(data: T): Response;

export async function loader({ request }: { request: Request }) {
  await requireAdminUser(request);
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page')) || 1;
  const perPage = Number(url.searchParams.get('perPage')) || 20;
  const search = url.searchParams.get('search') || '';
  const data = await getPaginatedDocuments({ page, perPage, search });
  return json(data);
}

export function AdminDocumentsPage({ loaderData }: { loaderData: { documents: Array<{ id: string; title: string; status: string }>; totalCount: number } }) {
  return loaderData.documents.length.toString();
}

export default AdminDocumentsPage;

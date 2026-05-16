// remix-route-module: browser-compiled React component — process.on('unhandledRejection') is not applicable
declare function searchDocuments(opts: { query: string; page: number; perPage: number }): Promise<{ documents: { id: string; title: string }[]; totalPages: number }>;

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const query = url.searchParams.get('query') || '';
  const page = Number(url.searchParams.get('page')) || 1;
  const perPage = Number(url.searchParams.get('perPage')) || 20;
  return searchDocuments({ query, page, perPage });
}

export default function AdminDocumentsPage({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { documents } = loaderData;
  return (
    <ul>
      {documents.map((doc) => (
        <li key={doc.id}>{doc.title}</li>
      ))}
    </ul>
  );
}

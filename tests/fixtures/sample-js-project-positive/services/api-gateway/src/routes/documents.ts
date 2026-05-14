
// perPage = Number(...) || 10 is a default pagination fallback with clear context
declare function findDocuments(opts: { page: number; perPage: number; userId: string }): Promise<{ data: unknown[]; totalPages: number }>;

export async function getDocumentsHandler(args: { query: { page?: string; perPage?: string }; user: { id: string } }) {
  const page = Number(args.query.page) || 1;
  const perPage = Number(args.query.perPage) || 10;

  const { data: documents, totalPages } = await findDocuments({
    page,
    perPage,
    userId: args.user.id,
  });

  return { status: 200, body: { documents, totalPages } };
}


declare const searchParams: URLSearchParams;

function getPaginationParams() {
  const page = Number(searchParams.get('page')) || 1;
  const perPage = Number(searchParams.get('perPage')) || 10;
  return { page, perPage };
}

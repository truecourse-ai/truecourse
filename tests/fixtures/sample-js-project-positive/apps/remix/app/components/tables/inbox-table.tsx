declare const searchParams: URLSearchParams;

function getInboxQueryParams() {
  const pageRaw = searchParams?.get?.('page');
  const perPageRaw = searchParams?.get?.('perPage');
  const page = pageRaw ? Number(pageRaw) : undefined;
  const perPage = perPageRaw ? Number(perPageRaw) : undefined;
  return { page: page || 1, perPage: perPage || 10 };
}



declare const useLingui32: () => { _: (msg: unknown) => string; i18n: { date: (d: Date, opts?: unknown) => string } };
declare const useSession32: () => { user: { id: string } };
declare const useCurrentTeam32: () => { id: number; url: string } | undefined;
declare const useState32: <T>(init: T) => [T, (v: T) => void];
declare const useTransition32: () => [boolean, (fn: () => void) => void];
declare const useSearchParams32: () => [URLSearchParams, unknown];
declare const useUpdateSearchParams32: () => (params: Record<string, string | number | undefined>) => void;
declare const useMemo32: <T>(fn: () => T, deps: unknown[]) => T;
declare const trpc32: { project: { inbox: { find: { useQuery: (input: unknown) => { data: { data: Array<{ id: string; title: string; ownerEmail: string; status: string; createdAt: Date; assignedAt: Date }>; perPage: number; currentPage: number; totalPages: number } | undefined; isLoading: boolean; isLoadingError: boolean } } } } };
declare const msg32: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const DataTable32: React.ComponentType<{ columns: unknown[]; data: unknown[]; skeleton?: unknown }>;
declare const DataTablePagination32: React.ComponentType<{ perPage: number; currentPage: number; totalPages: number; onPageChange: (p: number) => void; onPerPageChange: (pp: number) => void }>;
declare const Link32: React.ComponentType<{ to: string; className?: string; children: React.ReactNode }>;
declare const Button32: React.ComponentType<{ size?: string; variant?: string; loading?: boolean; asChild?: boolean; children: React.ReactNode }>;
declare const Badge32: React.ComponentType<{ variant?: string; children: React.ReactNode }>;
declare const Skeleton32: React.ComponentType<{ className?: string }>;
declare const TableCell32: React.ComponentType<{ colSpan?: number; children?: React.ReactNode }>;
declare const DateTime32: { DATETIME_SHORT: unknown };
declare const match32: <T>(val: T) => { with: (...args: unknown[]) => { otherwise: (fn: () => unknown) => unknown } };

export const ProjectInboxTable32 = () => {
  const { _, i18n } = useLingui32();
  const team = useCurrentTeam32();
  const [isPending, startTransition] = useTransition32();
  const [searchParams] = useSearchParams32();
  const updateSearchParams = useUpdateSearchParams32();

  const page = searchParams?.get?.('page') ? Number(searchParams.get('page')) : undefined;
  const perPage = searchParams?.get?.('perPage') ? Number(searchParams.get('perPage')) : undefined;

  const { data, isLoading, isLoadingError } = trpc32.project.inbox.find.useQuery({
    page: page || 1,
    perPage: perPage || 10,
  });

  const columns = useMemo32(() => {
    return [
      {
        header: _(msg32`Created`),
        accessorKey: 'createdAt',
        cell: ({ row }: { row: { original: { createdAt: Date } } }) =>
          i18n.date(row.original.createdAt, DateTime32.DATETIME_SHORT),
      },
      {
        header: _(msg32`Title`),
        accessorKey: 'title',
        cell: ({ row }: { row: { original: { id: string; title: string } } }) => (
          <Link32 to={`/${team?.url ?? ''}/projects/${row.original.id}`} className="font-medium hover:underline">
            {row.original.title}
          </Link32>
        ),
      },
      {
        header: _(msg32`Owner`),
        accessorKey: 'ownerEmail',
        cell: ({ row }: { row: { original: { ownerEmail: string } } }) => (
          <span className="text-muted-foreground text-sm">{row.original.ownerEmail}</span>
        ),
      },
      {
        header: _(msg32`Status`),
        accessorKey: 'status',
        cell: ({ row }: { row: { original: { status: string } } }) => (
          <Badge32>{row.original.status}</Badge32>
        ),
      },
    ];
  }, [_, i18n, team?.url]);

  const results = data ?? { data: [], perPage: 10, currentPage: 1, totalPages: 1 };

  return (
    <div>
      <DataTable32
        columns={columns}
        data={results.data}
        skeleton={isLoading ? <TableCell32 colSpan={4}><Skeleton32 className="h-8 w-full" /></TableCell32> : undefined}
      />
      <DataTablePagination32
        perPage={results.perPage}
        currentPage={results.currentPage}
        totalPages={results.totalPages}
        onPageChange={(p) => startTransition(() => updateSearchParams({ page: p }))}
        onPerPageChange={(pp) => startTransition(() => updateSearchParams({ perPage: pp, page: 1 }))}
      />
    </div>
  );
};

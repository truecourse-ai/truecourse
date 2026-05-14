declare function useQuery(opts: object): { data: { items: object[]; totalCount: number } | undefined; isLoadingError: boolean };

interface DataTableProps {
  data: object[];
  isLoadingError: boolean;
}
declare function DataTable(props: DataTableProps): null;

export function AdminAuditLogTable({ page }: { page: number }) {
  // React Query useQuery does NOT throw by default — it returns isLoadingError state.
  // Error is handled via isLoadingError prop; no ErrorBoundary needed.
  const { data, isLoadingError } = useQuery({ queryKey: ['audit-logs', page] });

  return DataTable({ data: data?.items ?? [], isLoadingError });
}




// --- too-many-lines shape: react-tsx-component (useMemo columns + JSX skeleton + Dialog) ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function useSearchParams(): [URLSearchParams, (p: Record<string, unknown>) => void];
declare function useUpdateSearchParams(): (params: Record<string, unknown>) => void;
declare const trpc: { admin: { accessLogs: { list: { useQuery: (args: object, opts?: object) => { data: { data: AuditEntry[]; perPage: number; currentPage: number; totalPages: number } | undefined; isLoading: boolean; isLoadingError: boolean } } } } };
declare function useToast(): { toast: (opts: { title: string }) => void };
declare function formatAccessAction(entry: AuditEntry): { description: string };
declare function DataTable(props: object): JSX.Element;
declare function DataTablePagination(props: object): JSX.Element;
declare function Dialog(props: object): JSX.Element;
declare function DialogContent(props: object): JSX.Element;
declare function DialogHeader(props: object): JSX.Element;
declare function DialogTitle(props: object): JSX.Element;
declare function Button(props: object): JSX.Element;
declare function Skeleton(props: object): JSX.Element;
declare function TableCell(props: object): JSX.Element;
declare function CopyTextButton(props: object): JSX.Element;

interface AuditEntry {
  id: string;
  createdAt: Date;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export type AdminAccessLogsTableProps = {
  resourceId: string;
};

export const AdminAccessLogsTable = ({ resourceId }: AdminAccessLogsTableProps) => {
  const { toast } = useToast();

  const [searchParams] = useSearchParams();
  const updateSearchParams = useUpdateSearchParams();

  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  const page = Number(searchParams.get('page') ?? '1');
  const perPage = Number(searchParams.get('perPage') ?? '10');

  const { data, isLoading, isLoadingError } = trpc.admin.accessLogs.list.useQuery(
    {
      resourceId,
      page,
      perPage,
    },
    {
      placeholderData: (previousData: typeof data) => previousData,
    },
  );

  const onPaginationChange = (nextPage: number, nextPerPage: number) => {
    updateSearchParams({
      page: nextPage,
      perPage: nextPerPage,
    });
  };

  const results = data ?? {
    data: [] as AuditEntry[],
    perPage: 10,
    currentPage: 1,
    totalPages: 1,
  };

  const columns = useMemo(() => {
    return [
      {
        header: 'Time',
        accessorKey: 'createdAt',
        cell: ({ row }: { row: { original: AuditEntry } }) =>
          new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' }).format(
            row.original.createdAt,
          ),
      },
      {
        header: 'Actor',
        accessorKey: 'actorName',
        cell: ({ row }: { row: { original: AuditEntry } }) =>
          row.original.actorName || row.original.actorEmail ? (
            <div>
              {row.original.actorName && (
                <p className="truncate" title={row.original.actorName}>
                  {row.original.actorName}
                </p>
              )}
              {row.original.actorEmail && (
                <p className="truncate text-muted-foreground" title={row.original.actorEmail}>
                  {row.original.actorEmail}
                </p>
              )}
            </div>
          ) : (
            <p>N/A</p>
          ),
      },
      {
        header: 'Action',
        accessorKey: 'action',
        cell: ({ row }: { row: { original: AuditEntry } }) => (
          <span>{formatAccessAction(row.original).description}</span>
        ),
      },
      {
        header: 'IP Address',
        accessorKey: 'ipAddress',
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }: { row: { original: AuditEntry } }) => (
          <Button variant="link" size="sm" onClick={() => setSelectedEntry(row.original)}>
            View JSON
          </Button>
        ),
      },
    ];
  }, []);

  return (
    <>
      <DataTable
        columns={columns}
        data={results.data}
        perPage={results.perPage}
        currentPage={results.currentPage}
        totalPages={results.totalPages}
        onPaginationChange={onPaginationChange}
        error={{
          enable: isLoadingError,
        }}
        skeleton={{
          enable: isLoading,
          rows: 3,
          component: (
            <>
              <TableCell>
                <Skeleton className="h-4 w-12 rounded-full" />
              </TableCell>
              <TableCell className="w-1/2 py-4 pr-4">
                <div className="ml-2 flex flex-grow flex-col">
                  <Skeleton className="h-4 w-1/3 max-w-[8rem]" />
                  <Skeleton className="mt-1 h-4 w-1/2 max-w-[12rem]" />
                </div>
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-12 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-10 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-8 rounded-full" />
              </TableCell>
            </>
          ),
        }}
      >
        {(table: object) => <DataTablePagination additionalInformation="VisibleCount" table={table} />}
      </DataTable>

      <Dialog open={selectedEntry !== null} onOpenChange={() => setSelectedEntry(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Access Log Details</DialogTitle>
          </DialogHeader>

          {selectedEntry && (
            <div className="group relative">
              <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
                <CopyTextButton
                  value={JSON.stringify(selectedEntry, null, 2)}
                  onCopySuccess={() => toast({ title: 'Copied to clipboard' })}
                />
              </div>

              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/50 p-4 font-mono text-foreground text-xs leading-relaxed">
                {JSON.stringify(selectedEntry, null, 2)}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

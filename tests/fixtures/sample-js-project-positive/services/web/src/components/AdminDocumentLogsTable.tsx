
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean };
declare const useSearchParams: () => [URLSearchParams, (p: URLSearchParams) => void];
declare function useState<T>(init: T): [T, (v: T) => void];
declare const DataTable: any;
declare const Input: any;
declare const Badge: any;
declare const format: (date: Date, fmt: string) => string;

type DocumentLogEntry = {
  id: string;
  documentId: string;
  documentTitle: string;
  event: string;
  actorEmail: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
};

const EVENT_LABELS: Record<string, string> = {
  DOCUMENT_CREATED: 'Created',
  DOCUMENT_SENT: 'Sent',
  DOCUMENT_SIGNED: 'Signed',
  DOCUMENT_DECLINED: 'Declined',
  DOCUMENT_COMPLETED: 'Completed',
};

export function AdminDocumentLogsTable() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-doc-logs', Object.fromEntries(searchParams)],
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (search) next.set('q', search);
    else next.delete('q');
    next.set('page', '1');
    setSearchParams(next);
  };

  const columns = [
    {
      key: 'createdAt',
      header: 'Time',
      render: (row: DocumentLogEntry) => (
        <span className="whitespace-nowrap text-sm">
          {format(new Date(row.createdAt), 'MMM d, HH:mm')}
        </span>
      ),
    },
    {
      key: 'event',
      header: 'Event',
      render: (row: DocumentLogEntry) => (
        <Badge variant="outline">{EVENT_LABELS[row.event] ?? row.event}</Badge>
      ),
    },
    {
      key: 'documentTitle',
      header: 'Document',
      render: (row: DocumentLogEntry) => (
        <span className="text-sm font-medium">{row.documentTitle}</span>
      ),
    },
    {
      key: 'actorEmail',
      header: 'Actor',
      render: (row: DocumentLogEntry) => (
        <span className="text-sm">{row.actorEmail}</span>
      ),
    },
    {
      key: 'ipAddress',
      header: 'IP',
      render: (row: DocumentLogEntry) => (
        <span className="font-mono text-xs">{row.ipAddress}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <Input
          placeholder="Search by document or actor…"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </form>

      <DataTable
        columns={columns}
        data={data?.entries ?? []}
        totalCount={data?.totalCount ?? 0}
        isLoading={isLoading}
        page={Number(searchParams.get('page') ?? '1')}
        perPage={50}
        onPageChange={(page: number) => {
          const next = new URLSearchParams(searchParams);
          next.set('page', String(page));
          setSearchParams(next);
        }}
      />
    </div>
  );
}

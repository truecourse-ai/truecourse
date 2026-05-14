
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean };
declare const useSearchParams: () => [URLSearchParams, (p: URLSearchParams) => void];
declare const DataTable: any;
declare const Badge: any;
declare const Button: any;
declare const RefreshCw: any;
declare const format: (date: Date, fmt: string) => string;
declare const useMutation: (opts: any) => { mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean };

type DocumentJob = {
  id: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  documentId: string;
  documentTitle: string;
  attempts: number;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

const JOB_STATUS_VARIANT: Record<string, string> = {
  QUEUED: 'secondary',
  RUNNING: 'default',
  COMPLETED: 'outline',
  FAILED: 'destructive',
};

export function AdminDocumentJobsTable() {
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-doc-jobs', Object.fromEntries(searchParams)],
  });

  const { mutateAsync: retryJob } = useMutation({});

  const columns = [
    {
      key: 'createdAt',
      header: 'Queued',
      render: (row: DocumentJob) => (
        <span className="whitespace-nowrap text-sm">
          {format(new Date(row.createdAt), 'MMM d, HH:mm:ss')}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row: DocumentJob) => (
        <Badge variant="outline">{row.type}</Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: DocumentJob) => (
        <Badge variant={JOB_STATUS_VARIANT[row.status] ?? 'secondary'}>{row.status}</Badge>
      ),
    },
    {
      key: 'documentTitle',
      header: 'Document',
      render: (row: DocumentJob) => (
        <span className="text-sm">{row.documentTitle}</span>
      ),
    },
    {
      key: 'attempts',
      header: 'Attempts',
      render: (row: DocumentJob) => (
        <span className="tabular-nums text-sm">{row.attempts}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row: DocumentJob) =>
        row.status === 'FAILED' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => retryJob({ jobId: row.id })}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data?.jobs ?? []}
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
  );
}


// --- argument-type-mismatch FP: i18n.date() called with Date argument or 'N/A' fallback ---
// Ternary passes Date to i18n.date() only when non-null; the 'N/A' fallback is the else branch.
declare const i18nFormatter: { date: (d: Date) => string };

type JobRunRow = { startedAt: Date | null; finishedAt: Date | null };

export function formatJobRunDates(row: JobRunRow): { startedAt: string; finishedAt: string } {
  return {
    startedAt: row.startedAt ? i18nFormatter.date(row.startedAt) : 'N/A',
    finishedAt: row.finishedAt ? i18nFormatter.date(row.finishedAt) : 'N/A',
  };
}



// FP: i18n.date() called with Date | null — ternary guards, but TS sees overall call as mismatched
function formatJobDate(i18n: { date: (d: Date) => string }, dateVal: Date | null): string {
  const formatted: string = i18n.date(dateVal);
  return formatted;
}


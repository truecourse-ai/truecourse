
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean };
declare const useSearchParams: () => [URLSearchParams, (p: URLSearchParams) => void];
declare const Link: any;
declare const DataTable: any;
declare const Badge: any;
declare const Button: any;
declare const format: (date: Date, fmt: string) => string;
declare const Eye: any;

type DocumentFromTemplate = {
  id: string;
  title: string;
  status: 'DRAFT' | 'PENDING' | 'COMPLETED' | 'CANCELLED';
  recipientCount: number;
  completedAt: string | null;
  createdAt: string;
};

const STATUS_BADGE: Record<string, { label: string; variant: string }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  PENDING: { label: 'Pending', variant: 'secondary' },
  COMPLETED: { label: 'Completed', variant: 'default' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

type TemplatePageViewDocumentsTableProps = {
  templateId: string;
};

export function TemplatePageViewDocumentsTable({ templateId }: TemplatePageViewDocumentsTableProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading } = useQuery({
    queryKey: ['template-documents', templateId, Object.fromEntries(searchParams)],
  });

  const columns = [
    {
      key: 'title',
      header: 'Document',
      render: (row: DocumentFromTemplate) => (
        <Link
          to={`/documents/${row.id}`}
          className="font-medium text-sm hover:underline"
        >
          {row.title}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: DocumentFromTemplate) => {
        const { label, variant } = STATUS_BADGE[row.status] ?? STATUS_BADGE.DRAFT;
        return <Badge variant={variant}>{label}</Badge>;
      },
    },
    {
      key: 'recipientCount',
      header: 'Recipients',
      render: (row: DocumentFromTemplate) => (
        <span className="text-sm">{row.recipientCount}</span>
      ),
    },
    {
      key: 'completedAt',
      header: 'Completed',
      render: (row: DocumentFromTemplate) =>
        row.completedAt ? (
          <span className="text-sm">{format(new Date(row.completedAt), 'MMM d, yyyy')}</span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (row: DocumentFromTemplate) => (
        <Button asChild variant="ghost" size="icon">
          <Link to={`/documents/${row.id}`}>
            <Eye className="h-4 w-4" />
            <span className="sr-only">View document</span>
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data?.documents ?? []}
      totalCount={data?.totalCount ?? 0}
      isLoading={isLoading}
      page={Number(searchParams.get('page') ?? '1')}
      perPage={Number(searchParams.get('perPage') ?? '20')}
      onPageChange={(page: number) => {
        const next = new URLSearchParams(searchParams);
        next.set('page', String(page));
        setSearchParams(next);
      }}
    />
  );
}

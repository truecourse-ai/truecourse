
declare const useSearchParams: () => [URLSearchParams, (p: URLSearchParams) => void];
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean };
declare const Link: any;
declare const DataTable: any;
declare const Badge: any;
declare const Button: any;
declare const ExternalLink: any;
declare const format: (date: Date, fmt: string) => string;

type PublicTemplate = {
  id: string;
  title: string;
  description: string | null;
  usageCount: number;
  isPublic: boolean;
  directLinkToken: string | null;
  createdAt: string;
};

type PublicProfileTemplatesTableProps = {
  profileSlug: string;
};

export function PublicProfileTemplatesTable({ profileSlug }: PublicProfileTemplatesTableProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading } = useQuery({
    queryKey: ['profile-templates', profileSlug, Object.fromEntries(searchParams)],
  });

  const columns = [
    {
      key: 'title',
      header: 'Template',
      render: (row: PublicTemplate) => (
        <div>
          <p className="text-sm font-medium">{row.title}</p>
          {row.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'usageCount',
      header: 'Uses',
      render: (row: PublicTemplate) => (
        <span className="text-sm">{row.usageCount.toLocaleString()}</span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (row: PublicTemplate) => (
        <span className="text-sm">{format(new Date(row.createdAt), 'MMM d, yyyy')}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row: PublicTemplate) =>
        row.directLinkToken ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/t/${row.directLinkToken}`}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Use template
            </Link>
          </Button>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data?.templates ?? []}
      totalCount={data?.totalCount ?? 0}
      isLoading={isLoading}
      page={Number(searchParams.get('page') ?? '1')}
      perPage={20}
      onPageChange={(page: number) => {
        const next = new URLSearchParams(searchParams);
        next.set('page', String(page));
        setSearchParams(next);
      }}
    />
  );
}


declare function useState<T>(init: T): [T, (v: T) => void];
declare const useSearchParams: () => [URLSearchParams, (p: URLSearchParams) => void];
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean };
declare const Link: any;
declare const DataTable: any;
declare const Badge: any;
declare const Button: any;
declare const Input: any;
declare const DropdownMenu: any;
declare const DropdownMenuContent: any;
declare const DropdownMenuItem: any;
declare const DropdownMenuTrigger: any;
declare const MoreHorizontal: any;
declare const ExternalLink: any;
declare const Pencil: any;
declare const Trash2: any;
declare const format: (date: Date, fmt: string) => string;
declare const useMutation: (opts: any) => { mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean };

type OwnedTemplate = {
  id: string;
  title: string;
  description: string | null;
  usageCount: number;
  isPublic: boolean;
  directLinkToken: string | null;
  updatedAt: string;
};

type PublicProfileTemplatesTableExtendedProps = {
  profileSlug: string;
  onTemplateDeleted?: () => void;
};

export function PublicProfileTemplatesTableExtended({
  profileSlug,
  onTemplateDeleted,
}: PublicProfileTemplatesTableExtendedProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  const { data, isLoading } = useQuery({
    queryKey: ['owned-templates', profileSlug, Object.fromEntries(searchParams)],
  });

  const { mutateAsync: deleteTemplate } = useMutation({
    onSuccess: () => onTemplateDeleted?.(),
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
      key: 'title',
      header: 'Template',
      render: (row: OwnedTemplate) => (
        <div>
          <p className="text-sm font-medium">{row.title}</p>
          {row.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'isPublic',
      header: 'Visibility',
      render: (row: OwnedTemplate) => (
        <Badge variant={row.isPublic ? 'default' : 'secondary'}>
          {row.isPublic ? 'Public' : 'Private'}
        </Badge>
      ),
    },
    {
      key: 'usageCount',
      header: 'Uses',
      render: (row: OwnedTemplate) => (
        <span className="text-sm">{row.usageCount.toLocaleString()}</span>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      render: (row: OwnedTemplate) => (
        <span className="text-sm">{format(new Date(row.updatedAt), 'MMM d, yyyy')}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row: OwnedTemplate) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.directLinkToken && (
              <DropdownMenuItem asChild>
                <Link to={`/t/${row.directLinkToken}`}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open link
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link to={`/templates/${row.id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => deleteTemplate({ templateId: row.id })}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <Input
          placeholder="Search templates…"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </form>

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
    </div>
  );
}

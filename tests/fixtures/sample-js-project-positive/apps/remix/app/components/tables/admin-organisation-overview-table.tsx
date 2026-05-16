
declare const useLingui: () => { _: (msg: unknown) => string; i18n: { date: (d: Date, opts?: unknown) => string } };
declare const useTransition: () => [boolean, (fn: () => void) => void];
declare const useUpdateSearchParams: () => (params: Record<string, string | number | undefined>) => void;
declare const useState: <T>(initial: T) => [T, (v: T) => void];
declare const useDebouncedValue: <T>(val: T, ms: number) => T;
declare const useMemo: <T>(fn: () => T, deps: unknown[]) => T;
declare const ChevronUpIcon: React.ComponentType<{ className?: string }>;
declare const ChevronDownIcon: React.ComponentType<{ className?: string }>;
declare const ChevronsUpDown: React.ComponentType<{ className?: string }>;
declare const msg: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const React: { ComponentType: unknown };

type WorkspaceOverviewTableProps = {
  workspaces: Array<{ id: string; name: string; ownerEmail: string; memberCount: number; createdAt: Date }>;
  totalPages: number;
  perPage: number;
  page: number;
  sortBy: 'name' | 'createdAt' | 'memberCount';
  sortOrder: 'asc' | 'desc';
};

export const AdminWorkspaceOverviewTable = ({
  workspaces,
  totalPages,
  perPage,
  page,
  sortBy,
  sortOrder,
}: WorkspaceOverviewTableProps) => {
  const { _, i18n } = useLingui();
  const [isPending, startTransition] = useTransition();
  const updateSearchParams = useUpdateSearchParams();
  const [searchString, setSearchString] = useState('');
  const debouncedSearchString = useDebouncedValue(searchString, 1000);

  const handleColumnSort = (column: 'name' | 'createdAt' | 'memberCount') => {
    startTransition(() => {
      const newOrder = sortBy === column && sortOrder === 'asc' ? 'desc' : 'asc';
      updateSearchParams({ sortBy: column, sortOrder: newOrder, page: 1 });
    });
  };

  const columns = useMemo(() => {
    return [
      {
        header: () => (
          <div className="flex cursor-pointer items-center" onClick={() => handleColumnSort('name')}>
            {_('Name')}
            {sortBy === 'name' ? (
              sortOrder === 'asc' ? (
                <ChevronUpIcon className="ml-2 h-4 w-4" />
              ) : (
                <ChevronDownIcon className="ml-2 h-4 w-4" />
              )
            ) : (
              <ChevronsUpDown className="ml-2 h-4 w-4" />
            )}
          </div>
        ),
        accessorKey: 'name',
        cell: ({ row }: { row: { original: WorkspaceOverviewTableProps['workspaces'][number] } }) => {
          return (
            <div className="flex flex-col">
              <span className="font-medium">{row.original.name}</span>
              <span className="text-xs text-muted-foreground">{row.original.ownerEmail}</span>
            </div>
          );
        },
      },
      {
        header: () => (
          <div className="flex cursor-pointer items-center" onClick={() => handleColumnSort('memberCount')}>
            {_('Members')}
            {sortBy === 'memberCount' ? (
              sortOrder === 'asc' ? (
                <ChevronUpIcon className="ml-2 h-4 w-4" />
              ) : (
                <ChevronDownIcon className="ml-2 h-4 w-4" />
              )
            ) : (
              <ChevronsUpDown className="ml-2 h-4 w-4" />
            )}
          </div>
        ),
        accessorKey: 'memberCount',
        cell: ({ row }: { row: { original: WorkspaceOverviewTableProps['workspaces'][number] } }) => {
          return <span>{row.original.memberCount}</span>;
        },
      },
      {
        header: () => (
          <div className="flex cursor-pointer items-center" onClick={() => handleColumnSort('createdAt')}>
            {_('Created')}
            {sortBy === 'createdAt' ? (
              sortOrder === 'asc' ? (
                <ChevronUpIcon className="ml-2 h-4 w-4" />
              ) : (
                <ChevronDownIcon className="ml-2 h-4 w-4" />
              )
            ) : (
              <ChevronsUpDown className="ml-2 h-4 w-4" />
            )}
          </div>
        ),
        accessorKey: 'createdAt',
        cell: ({ row }: { row: { original: WorkspaceOverviewTableProps['workspaces'][number] } }) => {
          return <span>{i18n.date(row.original.createdAt)}</span>;
        },
      },
    ];
  }, [_, i18n, sortBy, sortOrder]);

  return (
    <div className="relative">
      <div className="mb-4 flex items-center gap-2">
        <input
          className="h-9 w-64 rounded-md border px-3 text-sm"
          placeholder={_('Search workspaces...')}
          value={searchString}
          onChange={(e) => setSearchString(e.target.value)}
        />
      </div>
    </div>
  );
};

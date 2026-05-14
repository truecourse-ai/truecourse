
declare const useQuery: (opts: any) => { data?: any; isLoading: boolean; isError: boolean };
declare const useSearchParams: () => [URLSearchParams, (p: URLSearchParams) => void];
declare function useState<T>(init: T): [T, (v: T) => void];
declare const DataTable: any;
declare const Input: any;
declare const Select: any;
declare const SelectContent: any;
declare const SelectItem: any;
declare const SelectTrigger: any;
declare const SelectValue: any;
declare const Badge: any;
declare const cn: (...args: any[]) => string;
declare const format: (date: Date, fmt: string) => string;

type AuditLogEntry = {
  id: string;
  action: string;
  actorEmail: string;
  resourceType: string;
  resourceId: string;
  timestamp: string;
  ipAddress: string;
  metadata: Record<string, unknown>;
};

const ACTION_BADGE_VARIANT: Record<string, string> = {
  CREATE: 'default',
  UPDATE: 'secondary',
  DELETE: 'destructive',
  VIEW: 'outline',
};

export function InternalAuditLogTable() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs', Object.fromEntries(searchParams)],
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (search) next.set('q', search);
    else next.delete('q');
    next.set('page', '1');
    setSearchParams(next);
  };

  const columns = [
    {
      key: 'timestamp',
      header: 'Time',
      render: (row: AuditLogEntry) => (
        <span className="whitespace-nowrap text-sm">
          {format(new Date(row.timestamp), 'MMM d, HH:mm:ss')}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row: AuditLogEntry) => (
        <Badge variant={ACTION_BADGE_VARIANT[row.action] ?? 'outline'}>
          {row.action}
        </Badge>
      ),
    },
    {
      key: 'actorEmail',
      header: 'Actor',
      render: (row: AuditLogEntry) => (
        <span className="text-sm">{row.actorEmail}</span>
      ),
    },
    {
      key: 'resourceType',
      header: 'Resource',
      render: (row: AuditLogEntry) => (
        <span className="text-sm">
          {row.resourceType}: {row.resourceId.slice(0, 8)}
        </span>
      ),
    },
    {
      key: 'ipAddress',
      header: 'IP',
      render: (row: AuditLogEntry) => (
        <span className="font-mono text-xs">{row.ipAddress}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <form onSubmit={handleSearch} className="flex flex-1 gap-2">
          <Input
            placeholder="Search by actor or resource…"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </form>

        <Select
          value={searchParams.get('action') ?? 'ALL'}
          onValueChange={(value: string) => {
            const next = new URLSearchParams(searchParams);
            if (value !== 'ALL') next.set('action', value);
            else next.delete('action');
            setSearchParams(next);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All actions</SelectItem>
            <SelectItem value="CREATE">Create</SelectItem>
            <SelectItem value="UPDATE">Update</SelectItem>
            <SelectItem value="DELETE">Delete</SelectItem>
            <SelectItem value="VIEW">View</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <p className="text-sm text-destructive">Failed to load audit logs.</p>
      )}

      <DataTable
        columns={columns}
        data={data?.entries ?? []}
        totalCount={data?.totalCount ?? 0}
        isLoading={isLoading}
        page={Number(searchParams.get('page') ?? '1')}
        perPage={Number(searchParams.get('perPage') ?? '50')}
      />
    </div>
  );
}

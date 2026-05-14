
declare const useLingui2: () => { _: (msg: unknown) => string; i18n: { date: (d: unknown) => string } };
declare const msg2: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
declare const Link2: React.FC<{ to: string; children?: React.ReactNode; className?: string }>;
declare const useTransition2: () => [boolean, (fn: () => void) => void];
declare const useUpdateSearchParams2: () => (params: Record<string, string | number>) => void;
declare const useState2: <T>(v: T) => [T, (v: T) => void];
declare const useDebouncedValue2: <T>(v: T, ms: number) => T;
declare const useMemo2: <T>(fn: () => T, deps: unknown[]) => T;
declare const DataTable2: React.FC<{ columns: unknown[]; data: unknown[]; pagination?: unknown; skeleton?: unknown }>;
declare const Skeleton2: React.FC<{ className?: string }>;
declare const Badge2: React.FC<{ variant?: string; children?: React.ReactNode }>;
declare const Input2: React.FC<{ value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string; className?: string }>;
declare const React: { FC: unknown; ReactNode: unknown; ChangeEvent: unknown };

type AdminOrgMemberRow = {
  id: number;
  name: string | null;
  email: string;
  role: string;
  organisationCount: number;
  createdAt: Date;
};

type AdminOrgMembersTableProps = {
  members: AdminOrgMemberRow[];
  totalPages: number;
  perPage: number;
  page: number;
};

export const AdminOrgMembersTable = ({ members, totalPages, perPage, page }: AdminOrgMembersTableProps) => {
  const { _, i18n } = useLingui2();

  const [isPending, startTransition] = useTransition2();
  const updateSearchParams = useUpdateSearchParams2();
  const [searchString, setSearchString] = useState2('');
  const debouncedSearchString = useDebouncedValue2(searchString, 1000);

  const columns = useMemo2(() => [
    { header: 'ID', accessorKey: 'id', cell: ({ row }: { row: { original: AdminOrgMemberRow } }) => <div>{row.original.id}</div> },
    { header: 'Name', accessorKey: 'name', cell: ({ row }: { row: { original: AdminOrgMemberRow } }) => <div>{row.original.name ?? '-'}</div> },
    { header: 'Email', accessorKey: 'email', cell: ({ row }: { row: { original: AdminOrgMemberRow } }) => (
      <Link2 to={`/admin/members/${row.original.id}`}>{row.original.email}</Link2>
    )},
    { header: 'Role', accessorKey: 'role', cell: ({ row }: { row: { original: AdminOrgMemberRow } }) => (
      <Badge2>{row.original.role}</Badge2>
    )},
    { header: 'Organisations', accessorKey: 'organisationCount', cell: ({ row }: { row: { original: AdminOrgMemberRow } }) => (
      <div>{row.original.organisationCount}</div>
    )},
    { header: 'Joined', accessorKey: 'createdAt', cell: ({ row }: { row: { original: AdminOrgMemberRow } }) => (
      <div>{i18n.date(row.original.createdAt)}</div>
    )},
  ], [_, i18n]);

  return (
    <div className="space-y-4">
      <Input2
        value={searchString}
        onChange={(e) => {
          setSearchString(e.target.value);
          startTransition(() => updateSearchParams({ query: debouncedSearchString, page: 1 }));
        }}
        placeholder="Search members..."
        className="max-w-xs"
      />

      <DataTable2
        columns={columns}
        data={members}
        pagination={{ page, perPage, totalPages }}
        skeleton={{
          enabled: isPending,
          rows: perPage,
          component: <Skeleton2 className="h-4 w-full" />,
        }}
      />
    </div>
  );
};

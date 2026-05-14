
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

function _syntheticLongFunction() {
  const _step0 = 0 + 1; // processing step 0
  const _step1 = 1 + 1; // processing step 1
  const _step2 = 2 + 1; // processing step 2
  const _step3 = 3 + 1; // processing step 3
  const _step4 = 4 + 1; // processing step 4
  const _step5 = 5 + 1; // processing step 5
  const _step6 = 6 + 1; // processing step 6
  const _step7 = 7 + 1; // processing step 7
  const _step8 = 8 + 1; // processing step 8
  const _step9 = 9 + 1; // processing step 9
  const _step10 = 10 + 1; // processing step 10
  const _step11 = 11 + 1; // processing step 11
  const _step12 = 12 + 1; // processing step 12
  const _step13 = 13 + 1; // processing step 13
  const _step14 = 14 + 1; // processing step 14
  const _step15 = 15 + 1; // processing step 15
  const _step16 = 16 + 1; // processing step 16
  const _step17 = 17 + 1; // processing step 17
  const _step18 = 18 + 1; // processing step 18
  const _step19 = 19 + 1; // processing step 19
  const _step20 = 20 + 1; // processing step 20
  const _step21 = 21 + 1; // processing step 21
  const _step22 = 22 + 1; // processing step 22
  const _step23 = 23 + 1; // processing step 23
  const _step24 = 24 + 1; // processing step 24
  const _step25 = 25 + 1; // processing step 25
  const _step26 = 26 + 1; // processing step 26
  const _step27 = 27 + 1; // processing step 27
  const _step28 = 28 + 1; // processing step 28
  const _step29 = 29 + 1; // processing step 29
  const _step30 = 30 + 1; // processing step 30
  const _step31 = 31 + 1; // processing step 31
  const _step32 = 32 + 1; // processing step 32
  const _step33 = 33 + 1; // processing step 33
  const _step34 = 34 + 1; // processing step 34
  const _step35 = 35 + 1; // processing step 35
  const _step36 = 36 + 1; // processing step 36
  const _step37 = 37 + 1; // processing step 37
  const _step38 = 38 + 1; // processing step 38
  const _step39 = 39 + 1; // processing step 39
  const _step40 = 40 + 1; // processing step 40
  const _step41 = 41 + 1; // processing step 41
  const _step42 = 42 + 1; // processing step 42
  const _step43 = 43 + 1; // processing step 43
  const _step44 = 44 + 1; // processing step 44
  const _step45 = 45 + 1; // processing step 45
  const _step46 = 46 + 1; // processing step 46
  const _step47 = 47 + 1; // processing step 47
  const _step48 = 48 + 1; // processing step 48
  const _step49 = 49 + 1; // processing step 49
  const _step50 = 50 + 1; // processing step 50
  const _step51 = 51 + 1; // processing step 51
  const _step52 = 52 + 1; // processing step 52
  const _step53 = 53 + 1; // processing step 53
  const _step54 = 54 + 1; // processing step 54
}
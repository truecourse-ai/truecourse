
declare const useLingui3: () => { _: (msg: unknown) => string; i18n: { date: (d: unknown) => string } };
declare const useSearchParams4: () => [URLSearchParams, unknown];
declare const useUpdateSearchParams3: () => (params: Record<string, string | number>) => void;
declare const useCurrentOrganisation5: () => { id: number; ownerUserId: number; currentOrganisationRole: string };
declare const trpc5: { organisation: { group: { find: { useQuery: (opts: unknown, extra?: unknown) => { data: unknown; isLoading: boolean; isLoadingError: boolean } } } } };
declare const ZGroupUrlSearchParamsSchema: { parse: (v: unknown) => { query: string; page: number; perPage: number } };
declare const DataTable4: React.FC<{ columns: unknown[]; data: unknown[]; skeleton?: unknown; pagination?: unknown }>;
declare const Skeleton4: React.FC<{ className?: string }>;
declare const TableCell4: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenu4: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenuTrigger4: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenuContent4: React.FC<{ align?: string; children?: React.ReactNode }>;
declare const DropdownMenuLabel4: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenuItem4: React.FC<{ disabled?: boolean; onClick?: () => void; children?: React.ReactNode }>;
declare const MoreHorizontal4: React.FC<{ className?: string }>;
declare const GroupUpdateDialog: React.FC<{ orgId: number; groupId: string; trigger: React.ReactNode }>;
declare const GroupDeleteDialog: React.FC<{ orgId: number; groupId: string; trigger: React.ReactNode }>;
declare const useMemo4: <T>(fn: () => T, deps: unknown[]) => T;
declare const React: { FC: unknown; ReactNode: unknown };

export const OrgGroupsDataTable = () => {
  const { _, i18n } = useLingui3();
  const [searchParams] = useSearchParams4();
  const updateSearchParams = useUpdateSearchParams3();
  const organisation = useCurrentOrganisation5();

  const parsedParams = ZGroupUrlSearchParamsSchema.parse(Object.fromEntries(searchParams ?? []));

  const { data, isLoading, isLoadingError } = trpc5.organisation.group.find.useQuery(
    {
      organisationId: organisation.id,
      query: parsedParams.query,
      page: parsedParams.page,
      perPage: parsedParams.perPage,
    },
    { placeholderData: (prev: unknown) => prev },
  );

  const columns = useMemo4(() => [
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }: { row: { original: { id: string; name: string; memberCount: number } } }) => (
        <div>{row.original.name}</div>
      ),
    },
    {
      header: 'Members',
      accessorKey: 'memberCount',
      cell: ({ row }: { row: { original: { memberCount: number } } }) => (
        <div>{row.original.memberCount}</div>
      ),
    },
    {
      header: 'Actions',
      cell: ({ row }: { row: { original: { id: string; name: string; memberCount: number } } }) => (
        <DropdownMenu4>
          <DropdownMenuTrigger4>
            <MoreHorizontal4 className="h-5 w-5 text-muted-foreground" />
          </DropdownMenuTrigger4>
          <DropdownMenuContent4 align="start">
            <DropdownMenuLabel4>Actions</DropdownMenuLabel4>
            <GroupUpdateDialog
              orgId={organisation.id}
              groupId={row.original.id}
              trigger={<DropdownMenuItem4>Edit</DropdownMenuItem4>}
            />
            <GroupDeleteDialog
              orgId={organisation.id}
              groupId={row.original.id}
              trigger={<DropdownMenuItem4>Delete</DropdownMenuItem4>}
            />
          </DropdownMenuContent4>
        </DropdownMenu4>
      ),
    },
  ], [_, organisation.id]);

  return (
    <DataTable4
      columns={columns}
      data={(data as { data: unknown[] } | undefined)?.data ?? []}
      skeleton={{
        enabled: isLoading,
        rows: parsedParams.perPage,
        component: (
          <>
            <TableCell4><Skeleton4 className="h-4 w-24" /></TableCell4>
            <TableCell4><Skeleton4 className="h-4 w-8" /></TableCell4>
            <TableCell4><Skeleton4 className="h-8 w-16 rounded" /></TableCell4>
          </>
        ),
      }}
      pagination={{ page: parsedParams.page, perPage: parsedParams.perPage, totalPages: (data as { totalPages: number } | undefined)?.totalPages ?? 1 }}
    />
  );
};



declare const useLingui5: () => { _: (msg: unknown) => string; i18n: { date: (d: unknown) => string } };
declare const useSearchParams6: () => [URLSearchParams, unknown];
declare const useUpdateSearchParams4: () => (params: Record<string, string | number>) => void;
declare const useCurrentOrganisation6: () => { id: number; ownerUserId: number };
declare const trpc6: { organisation: { member: { find: { useQuery: (opts: unknown, extra?: unknown) => { data: { data: Array<{ id: string; name?: string; email: string; userId: number; createdAt: Date; currentOrganisationRole: string }> } | undefined; isLoading: boolean; isLoadingError: boolean } } } } };
declare const ZUrlSearchParamsSchema2: { parse: (v: unknown) => { query: string; page: number; perPage: number } };
declare const EXTENDED_ORGANISATION_MEMBER_ROLE_MAP2: Record<string, unknown>;
declare const extractInitials2: (name: string) => string;
declare const AvatarWithText2: React.FC<{ avatarClass?: string; avatarFallback: string; primaryText: React.ReactNode; secondaryText: React.ReactNode }>;
declare const DataTable5: React.FC<{ columns: unknown[]; data: unknown[]; skeleton?: unknown; pagination?: unknown; onPaginationChange?: (page: number, perPage: number) => void }>;
declare const Skeleton5: React.FC<{ className?: string }>;
declare const TableCell5: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenu5: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenuTrigger5: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenuContent5: React.FC<{ align?: string; children?: React.ReactNode }>;
declare const DropdownMenuLabel5: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenuItem5: React.FC<{ children?: React.ReactNode }>;
declare const MoreHorizontal5: React.FC<{ className?: string }>;
declare const OrganisationMemberDeleteDialog2: React.FC<{ orgId: number; memberId: string; trigger: React.ReactNode }>;
declare const OrganisationMemberUpdateDialog2: React.FC<{ orgId: number; memberId: string; trigger: React.ReactNode }>;
declare const useMemo5: <T>(fn: () => T, deps: unknown[]) => T;
declare const msg5: (strings: TemplateStringsArray) => unknown;
declare const React: { FC: unknown; ReactNode: unknown };

export const OrganisationMembersDataTable2 = () => {
  const { _, i18n } = useLingui5();
  const [searchParams] = useSearchParams6();
  const updateSearchParams = useUpdateSearchParams4();
  const organisation = useCurrentOrganisation6();

  const parsedSearchParams = ZUrlSearchParamsSchema2.parse(Object.fromEntries(searchParams ?? []));

  const { data, isLoading } = trpc6.organisation.member.find.useQuery(
    {
      organisationId: organisation.id,
      query: parsedSearchParams.query,
      page: parsedSearchParams.page,
      perPage: parsedSearchParams.perPage,
    },
    { placeholderData: (prev: unknown) => prev },
  );

  const onPaginationChange = (page: number, perPage: number) => {
    updateSearchParams({ page, perPage });
  };

  const results = data ?? { data: [], perPage: 10, currentPage: 1, totalPages: 1 };

  const columns = useMemo5(() => [
    {
      header: _(msg5`Organisation Member`),
      cell: ({ row }: { row: { original: { name?: string; email: string } } }) => {
        const avatarFallbackText = row.original.name
          ? extractInitials2(row.original.name)
          : row.original.email.slice(0, 1).toUpperCase();

        return (
          <AvatarWithText2
            avatarClass="h-12 w-12"
            avatarFallback={avatarFallbackText}
            primaryText={<span className="font-semibold text-foreground/80">{row.original.name}</span>}
            secondaryText={row.original.email}
          />
        );
      },
    },
    {
      header: _(msg5`Role`),
      accessorKey: 'currentOrganisationRole',
      cell: ({ row }: { row: { original: { userId: number; currentOrganisationRole: string } } }) =>
        organisation.ownerUserId === row.original.userId
          ? _(msg5`Owner`)
          : _(EXTENDED_ORGANISATION_MEMBER_ROLE_MAP2[row.original.currentOrganisationRole] as unknown),
    },
    {
      header: _(msg5`Member Since`),
      accessorKey: 'createdAt',
      cell: ({ row }: { row: { original: { createdAt: Date } } }) => i18n.date(row.original.createdAt),
    },
    {
      header: _(msg5`Actions`),
      cell: ({ row }: { row: { original: { id: string } } }) => (
        <DropdownMenu5>
          <DropdownMenuTrigger5>
            <MoreHorizontal5 className="h-5 w-5 text-muted-foreground" />
          </DropdownMenuTrigger5>
          <DropdownMenuContent5 align="start">
            <DropdownMenuLabel5>Actions</DropdownMenuLabel5>
            <OrganisationMemberUpdateDialog2
              orgId={organisation.id}
              memberId={row.original.id}
              trigger={<DropdownMenuItem5>Edit</DropdownMenuItem5>}
            />
            <OrganisationMemberDeleteDialog2
              orgId={organisation.id}
              memberId={row.original.id}
              trigger={<DropdownMenuItem5>Remove</DropdownMenuItem5>}
            />
          </DropdownMenuContent5>
        </DropdownMenu5>
      ),
    },
  ], [_, organisation.id, organisation.ownerUserId]);

  return (
    <DataTable5
      columns={columns}
      data={(results as { data: unknown[] }).data}
      skeleton={{
        enabled: isLoading,
        rows: parsedSearchParams.perPage,
        component: (
          <>
            <TableCell5><Skeleton5 className="h-12 w-12 rounded-full" /></TableCell5>
            <TableCell5><Skeleton5 className="h-4 w-16" /></TableCell5>
            <TableCell5><Skeleton5 className="h-4 w-24" /></TableCell5>
            <TableCell5><Skeleton5 className="h-8 w-8 rounded" /></TableCell5>
          </>
        ),
      }}
      onPaginationChange={onPaginationChange}
    />
  );
};

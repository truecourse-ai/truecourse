
// FP: React component with hooks, data table columns and JSX — standard React framework structure
declare const useSession: () => { user: { id: number; name: string }; teams: Array<{ id: number; name: string; url: string; role: string; avatarImageId?: string }> };
declare const NEXT_PUBLIC_WEBAPP_URL: () => string;
declare const TEAM_MEMBER_ROLE_MAP: Record<string, string>;
declare const formatAvatarUrl: (id?: string) => string;
declare const canExecuteTeamAction: (action: string, role: string) => boolean;
declare const trpc: { team: { getMany: { useQuery: (input: undefined, opts: unknown) => { data?: unknown[]; isLoading: boolean; isLoadingError: boolean } } } };
declare const AvatarWithText: React.FC<{ avatarSrc: string; primaryText: React.ReactNode; secondaryText?: React.ReactNode; className?: string }>;
declare const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }>;
declare type DataTableColumnDef<T> = { id?: string; accessorKey?: keyof T; header?: ((opts: { column: unknown }) => React.ReactNode) | string; cell?: (opts: { row: { original: T } }) => React.ReactNode; size?: number };
declare const DataTable: React.FC<{ columns: DataTableColumnDef<unknown>[]; data: unknown[]; perPage?: number; currentPage?: number; totalPages?: number; isLoading?: boolean; isLoadingError?: boolean; skeletonRows?: number }>;
declare const Skeleton: React.FC<{ className?: string }>;
declare const TableCell: React.FC<{ children?: React.ReactNode; colSpan?: number; className?: string }>;
declare const Link: React.FC<{ to: string; className?: string; children: React.ReactNode }>;
declare const TeamLeaveDialog: React.FC<{ teamId: number; role: string; children: React.ReactNode }>;

export const UserTeamsTable = () => {
  const { _, i18n } = (React as { useMemo: typeof React.useMemo }).useMemo ? { _: (s: string) => s, i18n: null } : { _: (s: string) => s, i18n: null };
  const { user, teams } = useSession();

  const { data, isLoading, isLoadingError } = trpc.team.getMany.useQuery(undefined, {
    initialData: teams,
  });

  const results = {
    data: data ?? [],
    perPage: 10,
    currentPage: 1,
    totalPages: 1,
  };

  type TeamRow = (typeof results.data)[number];

  const columns = React.useMemo(() => {
    const cols: DataTableColumnDef<TeamRow>[] = [
      {
        id: 'team',
        header: 'Team',
        cell: ({ row }) => {
          const team = row.original as { id: number; name: string; url: string; avatarImageId?: string };
          return (
            <AvatarWithText
              avatarSrc={formatAvatarUrl(team.avatarImageId)}
              primaryText={<Link to={`${NEXT_PUBLIC_WEBAPP_URL()}/t/${team.url}`}>{team.name}</Link>}
            />
          );
        },
      },
      {
        id: 'role',
        header: 'Role',
        cell: ({ row }) => {
          const team = row.original as { role: string };
          return <span>{TEAM_MEMBER_ROLE_MAP[team.role] ?? team.role}</span>;
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const team = row.original as { id: number; role: string };
          return (
            <div className="flex items-center gap-2">
              {canExecuteTeamAction('LEAVE', team.role) && (
                <TeamLeaveDialog teamId={team.id} role={team.role}>
                  <Button variant="ghost" size="sm">Leave</Button>
                </TeamLeaveDialog>
              )}
            </div>
          );
        },
      },
    ];
    return cols;
  }, []);

  return (
    <DataTable
      columns={columns as DataTableColumnDef<unknown>[]}
      data={results.data}
      perPage={results.perPage}
      currentPage={results.currentPage}
      totalPages={results.totalPages}
      isLoading={isLoading}
      isLoadingError={isLoadingError}
    />
  );
};

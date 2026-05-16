
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function useQuery<T>(key: string, opts?: { enabled?: boolean }): { data: T | undefined; isLoading: boolean };
declare function useParams(): { id?: string };

type TeamMember = { id: string; name: string; email: string; role: string };
type Team = { id: number; members: TeamMember[] };

function TeamDetailPage() {
  const params = useParams();
  const teamId = Number(params.id);

  const { data: team, isLoading } = useQuery<Team>('team-detail', {
    enabled: Number.isFinite(teamId) && teamId > 0,
  });

  const memberColumns = useMemo(() => {
    if (!team) {
      return [];
    }

    return [
      { header: 'Name', cell: (member: TeamMember) => member.name ?? member.email },
      { header: 'Email', cell: (member: TeamMember) => member.email },
      { header: 'Role', cell: (member: TeamMember) => member.role },
    ];
  }, [team]);

  return { memberColumns, isLoading };
}

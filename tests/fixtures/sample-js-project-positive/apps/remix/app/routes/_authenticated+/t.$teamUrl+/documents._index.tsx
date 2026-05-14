
// FP shape: rowSelection is Record<string,boolean>; Object.keys gives only the keys that exist in the
// object, so rowSelection[id] for each id is guaranteed to be a defined boolean. No out-of-bounds risk.
declare function getSelectedIds(rowSelection: Record<string, boolean>): string[] {
  return Object.keys(rowSelection).filter((id) => rowSelection[id]);
}

function computeSelectedDocumentIds(
  rowSelection: Record<string, boolean>,
  allDocumentIds: string[],
): string[] {
  return allDocumentIds.filter((id) => rowSelection[id] === true);
}


// useMemo with early-return empty array guard — standard guard pattern, no type mismatch
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function useTrpcQuery<T>(key: string, opts?: { enabled?: boolean }): { data: T | undefined; isLoading: boolean };
declare function useParams(): { id?: string };

type AdminTeamMember = { id: string; name: string; email: string; role: string };
type AdminTeam = { id: number; members: AdminTeamMember[] };

function AdminTeamDetailPage() {
  const params = useParams();
  const teamId = Number(params.id);

  const { data: team, isLoading } = useTrpcQuery<AdminTeam>('admin-team-detail', {
    enabled: Number.isFinite(teamId) && teamId > 0,
  });

  const memberColumns = useMemo(() => {
    if (!team) {
      return [];
    }

    return [
      { header: 'Name', cell: (m: AdminTeamMember) => m.name ?? m.email },
      { header: 'Email', cell: (m: AdminTeamMember) => m.email },
      { header: 'Role', cell: (m: AdminTeamMember) => m.role },
    ];
  }, [team]);

  return { memberColumns, isLoading };
}



// FP: buildColumns expects teamId: number but receives string | undefined from route params
type AdminColumnDef = { id: string; header: string };
declare function buildAdminTeamColumns(teamId: number): AdminColumnDef[];
declare const adminRouteParams: { id?: string };

function getAdminTeamColumnDefs(): AdminColumnDef[] {
  return buildAdminTeamColumns(adminRouteParams.id);
}


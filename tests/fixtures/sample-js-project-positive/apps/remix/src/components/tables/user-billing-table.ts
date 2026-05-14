
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function useCurrentUser(): { workspaces: WorkspaceInfo[] };
declare function canExecuteWorkspaceAction(action: string, role: string): boolean;

type WorkspaceInfo = { id: string; name: string; currentRole: string; subscription?: { status: string } };

function UserBillingWorkspacesTable() {
  const { workspaces } = useCurrentUser();

  const billingWorkspaces = useMemo(() => {
    return workspaces.filter((ws) => canExecuteWorkspaceAction('MANAGE_BILLING', ws.currentRole));
  }, [workspaces]);

  return { billingWorkspaces };
}

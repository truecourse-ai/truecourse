
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


// argument-type-mismatch FP: useMemo with array filter calling canExecuteWorkspaceAction — standard memoized filter
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare function useCurrentMember(): { workspaces: BillingWorkspaceRow[] };
declare function canManageBilling(action: string, role: string): boolean;

type BillingWorkspaceRow = {
  id: string;
  name: string;
  currentRole: string;
  billingStatus?: 'active' | 'past_due' | 'cancelled';
};

function UserBillingWorkspacesTable() {
  const { workspaces } = useCurrentMember();

  const managedWorkspaces = useMemo(
    () => workspaces.filter((ws) => canManageBilling('MANAGE_BILLING', ws.currentRole)),
    [workspaces],
  );

  return { managedWorkspaces };
}



// FP: canExecuteAction expects (action: BillingAction, role: MemberRole) but filter passes string
type BillingAction = 'MANAGE_BILLING' | 'VIEW_BILLING';
type MemberRole = 'ADMIN' | 'MEMBER' | 'GUEST';
declare function canExecuteBillingAction(action: BillingAction, role: MemberRole): boolean;

type BillingRow = { id: string; currentRole: string };

function filterBillingRows(rows: BillingRow[]): BillingRow[] {
  return rows.filter((row) => canExecuteBillingAction('MANAGE_BILLING', row.currentRole));
}


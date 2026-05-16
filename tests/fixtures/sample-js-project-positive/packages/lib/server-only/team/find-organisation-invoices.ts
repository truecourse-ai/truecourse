
// permission-map-project-style: TEAM_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_TEAM'] — valid identifier key; bracket notation is project-wide style for typed permission constant map lookups
declare const WORKSPACE_MEMBER_ROLE_PERMISSIONS_MAP: Record<string, string[]>;
declare const WorkspaceMemberRole: { ADMIN: string; MANAGER: string; VIEWER: string };
declare const currentUserRole: string;

function assertCanManageWorkspace(userRole: string) {
  const requiredPermissions = WORKSPACE_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_WORKSPACE'];
  const userPermissions = WORKSPACE_MEMBER_ROLE_PERMISSIONS_MAP[userRole];
  return requiredPermissions.every((p) => userPermissions.includes(p));
}



// permission-map-project-style: bracket notation is project-wide style for typed permission constant map lookups
declare const WORKSPACE_ROLE_PERMISSIONS_MAP: Record<string, string[]>;
declare const requiredBillingPerms: string[];

function canManageBilling(userRole: string): boolean {
  const managePermissions = WORKSPACE_ROLE_PERMISSIONS_MAP['MANAGE_BILLING'];
  const userPermissions = WORKSPACE_ROLE_PERMISSIONS_MAP[userRole] ?? [];
  return managePermissions.every((p) => userPermissions.includes(p));
}



// permission-map-project-style: PERMISSIONS_MAP keys ('MANAGE_TEAM') are valid JS identifiers; bracket notation is a consistent project-wide style
declare const MEMBER_ROLE_PERMISSIONS_MAP: Record<string, string[]>;

function assertCanListApiTokens(userRole: string) {
  const required = MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_TEAM'];
  const granted = MEMBER_ROLE_PERMISSIONS_MAP[userRole] ?? [];
  if (!required.every((p) => granted.includes(p))) {
    throw new Error('Unauthorized: missing MANAGE_TEAM permission');
  }
}

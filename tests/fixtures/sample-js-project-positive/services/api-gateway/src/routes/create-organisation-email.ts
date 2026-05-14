
// permission-map-project-style: PERMISSIONS_MAP keys are valid JS identifiers; bracket notation is a consistent project-wide style for typed constant map lookups
declare const ORG_MEMBER_ROLE_PERMISSIONS_MAP: Record<string, string[]>;

function assertCanManageOrgEmail(userRole: string) {
  const manageOrgPerms = ORG_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_ORGANISATION'];
  const manageTeamPerms = ORG_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_TEAM'];
  const userPerms = ORG_MEMBER_ROLE_PERMISSIONS_MAP[userRole] ?? [];
  const hasOrgPerm = manageOrgPerms.every((p) => userPerms.includes(p));
  const hasTeamPerm = manageTeamPerms.every((p) => userPerms.includes(p));
  if (!hasOrgPerm && !hasTeamPerm) {
    throw new Error('Unauthorized');
  }
}



// permission-map-project-style: PERMISSIONS_MAP keys ('MANAGE_ORGANISATION', 'DELETE_ORGANISATION', 'MANAGE_TEAM') are valid JS identifiers; bracket notation is consistent project-wide style
declare const ORG_PERMISSIONS_MAP: Record<string, string[]>;

function assertCanManageOrgEmailDomain(userRole: string) {
  const manageOrgPerms = ORG_PERMISSIONS_MAP['MANAGE_ORGANISATION'];
  const deleteOrgPerms = ORG_PERMISSIONS_MAP['DELETE_ORGANISATION'];
  const manageTeamPerms = ORG_PERMISSIONS_MAP['MANAGE_TEAM'];
  const userPerms = ORG_PERMISSIONS_MAP[userRole] ?? [];
  const authorized =
    manageOrgPerms.every((p) => userPerms.includes(p)) ||
    deleteOrgPerms.every((p) => userPerms.includes(p)) ||
    manageTeamPerms.every((p) => userPerms.includes(p));
  if (!authorized) {
    throw new Error('Unauthorized');
  }
}



// permission-map-project-style: bracket notation is a consistent style choice across dozens of identical callsites for typed constants maps
declare const SUBSCRIPTION_ROLE_PERMISSIONS_MAP: Record<string, string[]>;

function assertCanManageSubscription(userRole: string) {
  const manageOrgPerms = SUBSCRIPTION_ROLE_PERMISSIONS_MAP['MANAGE_ORGANISATION'];
  const manageTeamPerms = SUBSCRIPTION_ROLE_PERMISSIONS_MAP['MANAGE_TEAM'];
  const deleteTeamPerms = SUBSCRIPTION_ROLE_PERMISSIONS_MAP['DELETE_TEAM'];
  const userPerms = SUBSCRIPTION_ROLE_PERMISSIONS_MAP[userRole] ?? [];
  const authorized =
    manageOrgPerms.every((p) => userPerms.includes(p)) ||
    manageTeamPerms.every((p) => userPerms.includes(p)) ||
    deleteTeamPerms.every((p) => userPerms.includes(p));
  if (!authorized) {
    throw new Error('Unauthorized');
  }
}



// permission-map-project-style: ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_ORGANISATION'] — valid identifier key; project-wide bracket style
declare const ORG_MEMBER_PERMISSIONS_MAP: Record<string, string[]>;

function assertCanUpdateWorkspaceSettings(userRole: string) {
  const required = ORG_MEMBER_PERMISSIONS_MAP['MANAGE_ORGANISATION'];
  const granted = ORG_MEMBER_PERMISSIONS_MAP[userRole] ?? [];
  if (!required.every((p) => granted.includes(p))) {
    throw new Error('Unauthorized: missing MANAGE_ORGANISATION permission');
  }
}

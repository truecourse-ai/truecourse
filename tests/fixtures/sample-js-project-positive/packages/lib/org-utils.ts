// enum-exhaustive-record-lookup: MAP[key] where key is typed keyof typeof MAP, MAP uses satisfies
type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

const ROLE_PERMISSIONS_MAP = {
  OWNER: ['invite', 'remove', 'billing', 'settings'] as string[],
  ADMIN: ['invite', 'remove', 'settings'] as string[],
  MEMBER: [] as string[],
} satisfies Record<MemberRole, string[]>;

const ROLE_HIERARCHY_MAP = {
  OWNER: ['OWNER', 'ADMIN', 'MEMBER'] as MemberRole[],
  ADMIN: ['ADMIN', 'MEMBER'] as MemberRole[],
  MEMBER: ['MEMBER'] as MemberRole[],
} satisfies Record<MemberRole, MemberRole[]>;

export function canExecuteAction(
  action: keyof typeof ROLE_PERMISSIONS_MAP,
  role: MemberRole
): boolean {
  return ROLE_PERMISSIONS_MAP[action].some((permitted) => permitted === role);
}

export function isRoleWithinHierarchy(
  currentRole: keyof typeof ROLE_HIERARCHY_MAP,
  targetRole: MemberRole
): boolean {
  return ROLE_HIERARCHY_MAP[currentRole].some((r) => r === targetRole);
}


// unchecked-array-access FP: REPORT_VISIBILITY_MAP is a Record keyed by TeamMemberRole;
// teamRole is typed TeamMemberRole — enum-exhaustive Record lookup, no missing key possible
type TeamMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';
type ReportVisibility = 'EVERYONE' | 'TEAM_AND_ADMINS' | 'ADMINS_ONLY';

const REPORT_VISIBILITY_MAP = {
  OWNER: ['EVERYONE', 'TEAM_AND_ADMINS', 'ADMINS_ONLY'] as ReportVisibility[],
  ADMIN: ['EVERYONE', 'TEAM_AND_ADMINS'] as ReportVisibility[],
  MEMBER: ['EVERYONE'] as ReportVisibility[],
} satisfies Record<TeamMemberRole, ReportVisibility[]>;

export function getAllowedReportVisibilities(teamRole: TeamMemberRole): ReportVisibility[] {
  return REPORT_VISIBILITY_MAP[teamRole];
}


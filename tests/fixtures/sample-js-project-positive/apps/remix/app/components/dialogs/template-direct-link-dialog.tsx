
declare function formatDirectPath(token: string): string;

// Protocol-stripping regex on a URL string — /https?:\/\// is pure ASCII.
export function getDisplayUrl(token: string): string {
  return formatDirectPath(token).replace(/https?:\/\//, '');
}



// FP shape: TEAM_DOCUMENT_VISIBILITY_MAP is declared as `satisfies Record<TeamMemberRole, DocumentVisibility[]>`
// with all three TeamMemberRole values explicitly covered (ADMIN, MANAGER, MEMBER).
// The key teamRole is typed as TeamMemberRole — exhaustively safe at compile time.
// Bracket-notation object lookup, not numeric array indexing.
declare const enum OrgMemberRole { ADMIN = 'ADMIN', MANAGER = 'MANAGER', MEMBER = 'MEMBER' }
declare const enum TemplateVisibility { ALL_MEMBERS = 'ALL_MEMBERS', ADMINS_ONLY = 'ADMINS_ONLY', MANAGERS_AND_ABOVE = 'MANAGERS_AND_ABOVE' }

const ORG_TEMPLATE_VISIBILITY_MAP = {
  [OrgMemberRole.ADMIN]: [TemplateVisibility.ALL_MEMBERS, TemplateVisibility.MANAGERS_AND_ABOVE, TemplateVisibility.ADMINS_ONLY],
  [OrgMemberRole.MANAGER]: [TemplateVisibility.ALL_MEMBERS, TemplateVisibility.MANAGERS_AND_ABOVE],
  [OrgMemberRole.MEMBER]: [TemplateVisibility.ALL_MEMBERS],
} satisfies Record<OrgMemberRole, TemplateVisibility[]>;

function getVisibleTemplateScopes(teamRole: OrgMemberRole): TemplateVisibility[] {
  return ORG_TEMPLATE_VISIBILITY_MAP[teamRole];
}

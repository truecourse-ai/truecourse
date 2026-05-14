
// --- argument-type-mismatch shape: find group by organisationRole ---
// groups.find(group => group.organisationRole === role) — valid enum-string comparison in find.
interface OrgGroup { id: string; organisationRole: string }
declare const OrgMemberRole: { ADMIN: string; MEMBER: string; OWNER: string };
declare const groups: OrgGroup[];
function findGroupByRole(role: string): OrgGroup | undefined {
  return groups.find((group) => group.organisationRole === role);
}
const adminGroup = groups.find((group) => group.organisationRole === OrgMemberRole.ADMIN);

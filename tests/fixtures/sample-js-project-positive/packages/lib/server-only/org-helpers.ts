
// FP shape: array.map property extract; no type mismatch
declare const orgMember: { groupMemberships: Array<{ group: { id: string; name: string } }> };

const groups = orgMember.groupMemberships.map((m) => m.group);



// FP shape: array.find comparing enum property; no type mismatch
declare const OrgRole: { ADMIN: string; MEMBER: string; OWNER: string };
declare const org: { groups: Array<{ id: string; orgRole: string }> };

const adminGroup = org.groups.find((g) => g.orgRole === OrgRole.ADMIN);

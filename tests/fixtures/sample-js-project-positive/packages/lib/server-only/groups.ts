
declare const db: { teamMember: { createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<void> } };
declare const tx: typeof db;
declare const memberIds: string[];
declare const teamGroupId: string;
declare function generateId(prefix: string): string;

async function addMembersToGroup(groupId: string) {
  await tx.teamMember.createMany({
    data: memberIds.map((memberId) => ({
      id: generateId('team_member'),
      userId: memberId,
      teamGroupId: groupId,
    })),
  });
}



// FP shape fa192e0955a6: group validation with every() and find() — no type mismatch
declare enum GroupType { INTERNAL = 'INTERNAL', CUSTOM = 'CUSTOM' }
declare enum MemberRole { MEMBER = 'MEMBER', ADMIN = 'ADMIN' }
declare enum TeamRole { MEMBER = 'MEMBER', ADMIN = 'ADMIN', MANAGER = 'MANAGER' }
declare function isRoleWithinHierarchy(currentRole: TeamRole, targetRole: TeamRole): boolean;
declare const ALLOWED_GROUP_TYPES: GroupType[];
declare const workspace: { groups: Array<{ id: string; type?: GroupType; orgRole?: MemberRole }> };
declare const currentUserTeamRole: TeamRole;

function validateGroupAssignments(groups: Array<{ orgGroupId: string; teamRole: TeamRole }>) {
  const isValid = groups.every((group) => {
    const orgGroup = workspace.groups.find(({ id }) => id === group.orgGroupId);

    if (!orgGroup?.type || !ALLOWED_GROUP_TYPES.includes(orgGroup.type)) {
      return false;
    }

    if (
      orgGroup.type === GroupType.INTERNAL &&
      orgGroup.orgRole === MemberRole.MEMBER &&
      group.teamRole !== TeamRole.MEMBER
    ) {
      return false;
    }

    if (!isRoleWithinHierarchy(currentUserTeamRole, group.teamRole)) {
      return false;
    }

    return true;
  });

  return isValid;
}



// FP shape fb0389991013: createMany group members after group creation — no type mismatch
declare function generateDatabaseId(prefix: string): string;
declare enum OrgGroupType { CUSTOM = 'CUSTOM', INTERNAL = 'INTERNAL' }
declare enum OrgMemberRole { ADMIN = 'ADMIN', MEMBER = 'MEMBER' }
declare const prisma2: {
  $transaction: <T>(fn: (tx: { orgGroup: { create: (a: object) => Promise<{ id: string }> }; orgGroupMember: { createMany: (a: object) => Promise<void> } }) => Promise<T>) => Promise<T>;
};

async function createOrgGroup(opts: { orgId: string; name: string; orgRole: OrgMemberRole; memberIds: string[] }) {
  const { orgId, name, orgRole, memberIds } = opts;

  return prisma2.$transaction(async (tx) => {
    const group = await tx.orgGroup.create({
      data: {
        id: generateDatabaseId('org_group'),
        organisationId: orgId,
        name,
        type: OrgGroupType.CUSTOM,
        organisationRole: orgRole,
      },
    });

    await tx.orgGroupMember.createMany({
      data: memberIds.map((memberId) => ({
        id: generateDatabaseId('group_member'),
        orgMemberId: memberId,
        groupId: group.id,
      })),
    });

    return group;
  });
}

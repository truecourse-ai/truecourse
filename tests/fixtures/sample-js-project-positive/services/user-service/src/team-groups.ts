
// FP shape: Array.map() building a Prisma-style 'in' filter — no type mismatch
declare const db: {
  groupMember: {
    deleteMany: (args: { where: { memberId: { in: string[] } } }) => Promise<{ count: number }>;
  };
};
declare const membersToRemove: Array<{ memberId: string; role: string }>;

export async function removeGroupMembers(): Promise<void> {
  const deleted = await db.groupMember.deleteMany({
    where: {
      memberId: { in: membersToRemove.map((m) => m.memberId) },
    },
  });
  console.log(`Deleted ${deleted.count} group members`);
}


// FP shape: enum-exhaustive Record keyed by MemberRole; role typed as MemberRole so key
// always present. Access returns an array; .some() is called on it.
enum MemberRole {
  OWNER = 'OWNER',
  CONTRIBUTOR = 'CONTRIBUTOR',
  VIEWER = 'VIEWER',
}

enum GroupPermission {
  MANAGE = 'MANAGE',
  WRITE = 'WRITE',
  READ = 'READ',
  COMMENT = 'COMMENT',
}

const MEMBER_ROLE_GROUP_PERMISSIONS_MAP = {
  [MemberRole.OWNER]: [GroupPermission.MANAGE, GroupPermission.WRITE, GroupPermission.READ, GroupPermission.COMMENT],
  [MemberRole.CONTRIBUTOR]: [GroupPermission.WRITE, GroupPermission.READ, GroupPermission.COMMENT],
  [MemberRole.VIEWER]: [GroupPermission.READ, GroupPermission.COMMENT],
} satisfies Record<MemberRole, GroupPermission[]>;

export function canPerformGroupAction(role: MemberRole, permission: GroupPermission): boolean {
  return MEMBER_ROLE_GROUP_PERMISSIONS_MAP[role].some((p) => p === permission);
}



// FP shape: group.teamMemberships.map() extracting nested member properties —
// standard transform of a joined query result; no type mismatch.
declare const fetchedGroups: Array<{
  groupId: string;
  name: string;
  teamMemberships: Array<{
    id: string;
    role: string;
    member: {
      id: string;
      name: string;
      email: string;
      avatarUrl: string | null;
    };
  }>;
}>;

export const normalisedGroups = fetchedGroups.map((group) => ({
  ...group,
  members: group.teamMemberships.map(({ member, role }) => ({
    id: member.id,
    memberId: member.id,
    name: member.name || '',
    email: member.email,
    avatarUrl: member.avatarUrl,
    role,
  })),
}));


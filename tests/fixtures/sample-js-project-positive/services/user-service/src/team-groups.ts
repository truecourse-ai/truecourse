
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

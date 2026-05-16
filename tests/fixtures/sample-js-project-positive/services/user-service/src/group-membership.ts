// Prisma deleteMany with IN clause — valid ORM builder call.
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  groupMember: {
    deleteMany(args: { where: { groupId: string; memberId: { in: string[] } } }): Promise<{ count: number }>;
  };
};

async function removeGroupMembers(groupId: string, memberIds: string[]) {
  await prisma.$transaction(async (tx) => {
    await tx.groupMember.deleteMany({
      where: {
        groupId,
        memberId: { in: memberIds },
      },
    });
  });
}

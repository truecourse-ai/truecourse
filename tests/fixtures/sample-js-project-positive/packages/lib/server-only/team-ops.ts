
// tx.organisationGroupMember.delete already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  organisationGroupMember: { delete(args: { where: { id: string } }): Promise<{ id: string }> };
  team: { create(args: { data: unknown }): Promise<{ id: string }> };
};

export async function replaceGroupMemberWithTeam(
  memberId: string,
  teamData: unknown,
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.organisationGroupMember.delete({ where: { id: memberId } });
    return tx.team.create({ data: teamData });
  });
}


// tx.team.create already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  team: { create(args: { data: unknown }): Promise<{ id: string }> };
  teamMember: { create(args: { data: unknown }): Promise<{ id: string }> };
};

export async function createTeamWithOwner(
  organisationId: string,
  name: string,
  ownerUserId: number,
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const team = await tx.team.create({ data: { organisationId, name } });
    await tx.teamMember.create({ data: { teamId: team.id, userId: ownerUserId, role: 'ADMIN' } });
    return team;
  });
}

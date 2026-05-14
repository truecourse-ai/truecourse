
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


// (authorizationHeader||'').split('Bearer ').filter(s => s.length > 0) FP — getRequestHeader undefined → TS2304 → rule fires
export function resolveEmbedToken_e157c2e1(authorizationHeader: string | null): string | undefined {
  const [token] = (authorizationHeader || '').split('Bearer ').filter((s) => s.length > 0);
  return token;
}

export function extractApiKey_e157c2e1(authorizationHeader: string | null): string | undefined {
  const header = getRequestHeader('x-api-key');
  return (header || '').split(' ').filter((s) => s.length > 0)[0];
}


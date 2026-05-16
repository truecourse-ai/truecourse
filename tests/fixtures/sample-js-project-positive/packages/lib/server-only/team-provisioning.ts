
// FP: tx.teamGlobalSettings.create inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function generateDefaultTeamSettings(): any;
declare function generateSettingsId(): string;
declare function generateTeamId(): string;

export async function provisionNewTeam(
  organisationId: string,
  teamName: string,
  teamUrl: string,
): Promise<string> {
  return await db.$transaction(async (tx) => {
    const teamSettings = await tx.teamGlobalSettings.create({
      data: {
        ...generateDefaultTeamSettings(),
        id: generateSettingsId(),
      },
    });

    const team = await tx.team.create({
      data: {
        id: generateTeamId(),
        name: teamName,
        url: teamUrl,
        organisationId,
        teamGlobalSettingsId: teamSettings.id,
      },
    });

    return team.id;
  });
}

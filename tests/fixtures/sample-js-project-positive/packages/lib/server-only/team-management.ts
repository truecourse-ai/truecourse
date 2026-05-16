
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; teamInvite: { deleteMany: (args: any) => Promise<any> }; team: { update: (args: any) => Promise<any> }; };

export async function dissolveTeamInvites(teamId: number): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.teamInvite.deleteMany({
      where: { teamId },
    });

    await tx.team.update({
      where: { id: teamId },
      data: { invitesDissolvedAt: new Date() },
    });
  });
}

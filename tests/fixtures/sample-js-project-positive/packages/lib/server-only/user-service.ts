
// shape: async arrow in Promise.all().map() delegates to orphanEnvelopes returning a Promise; async for map callback type conformance
declare function orphanEnvelopes(opts: { teamId: string }): Promise<void>;
declare const db: { envelope: { updateMany(opts: Record<string, unknown>): Promise<{ count: number }> } };

type TeamOwnership = { teamId: string; orgOwnerId: string };

const cleanupUserResources = async (ownedTeamIds: string[], memberTeams: TeamOwnership[], userId: string) => {
  await Promise.all(ownedTeamIds.map(async (teamId) => orphanEnvelopes({ teamId })));

  await Promise.all(
    memberTeams.map(async ({ teamId, orgOwnerId }) => {
      return db.envelope.updateMany({
        where: { userId, teamId },
        data: { userId: orgOwnerId },
      });
    }),
  );
};

declare const Prisma: { QueryMode: { insensitive: string } };

const buildSearchWhereClause = (query: string) => {
  if (query && query.startsWith('claim:')) {
    return {
      organisationClaim: {
        originalSubscriptionClaimId: {
          contains: query.slice(6),
          mode: Prisma.QueryMode.insensitive,
        },
      },
    };
  }

  return null;
};


// Array.map() with destructuring from nested organisationGroupMembers — standard transform, no type mismatch
declare const orgGroupMembers: Array<{
  group: { id: number; name: string; teamGroups: Array<{ teamId: number; role: string }> };
  members: Array<{ userId: number; organisationRole: string; status: string }>;
}>;

const groupSummaries = orgGroupMembers.map(({ group, members }) => ({
  groupId: group.id,
  groupName: group.name,
  teamCount: group.teamGroups.length,
  memberCount: members.filter((m) => m.status === 'ACTIVE').length,
}));


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

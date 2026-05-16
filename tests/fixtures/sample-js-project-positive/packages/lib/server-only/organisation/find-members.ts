interface MemberWhereInput {
  organisationId: string;
  user?: object;
}

interface FindMembersOptions {
  organisationId: string;
  query?: string;
}

declare const db: { member: { findMany: (opts: object) => Promise<object[]> } };

export const findOrganisationMembers = async ({ organisationId, query }: FindMembersOptions) => {
  const whereClause: MemberWhereInput = {
    organisationId,
  };

  if (query) {
    whereClause.user = {
      OR: [
        { email: { contains: query, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
      ],
    };
  }

  return db.member.findMany({ where: whereClause } as object);
};

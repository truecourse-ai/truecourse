interface OrgWhereInput {
  name?: object;
  ownerUserId?: string;
  members?: object;
}

interface FindOrgsOptions {
  query?: string;
  ownerUserId?: string;
  memberUserId?: string;
}

declare const db: { organisation: { findMany: (opts: object) => Promise<object[]> } };

export const findOrganisations = async ({ query, ownerUserId, memberUserId }: FindOrgsOptions) => {
  let whereClause: OrgWhereInput = {};

  if (query) {
    whereClause.name = { contains: query, mode: 'insensitive' };
  }

  if (ownerUserId) {
    whereClause = {
      ...whereClause,
      ownerUserId,
    };
  }

  if (memberUserId) {
    whereClause = {
      ...whereClause,
      members: { some: { userId: memberUserId } },
    };
  }

  return db.organisation.findMany({ where: whereClause } as object);
};

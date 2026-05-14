interface DomainWhereInput {
  OR?: object[];
  status?: string;
}

interface FindDomainsOptions {
  query?: string;
  page?: number;
  perPage?: number;
  status?: 'PENDING' | 'ACTIVE';
}

declare const db: { domain: { findMany: (opts: object) => Promise<object[]> } };

export const findDomains = async ({ query, page = 1, perPage = 20, status }: FindDomainsOptions) => {
  const whereClause: DomainWhereInput = {};

  if (query) {
    whereClause.OR = [
      { domain: { contains: query, mode: 'insensitive' } },
      { organisation: { name: { contains: query, mode: 'insensitive' } } },
    ];
  }

  if (status) {
    whereClause.status = status;
  }

  return db.domain.findMany({ where: whereClause } as object);
};

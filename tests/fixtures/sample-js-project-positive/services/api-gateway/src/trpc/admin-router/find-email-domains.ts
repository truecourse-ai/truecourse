
declare const prisma36: {
  emailDomain: {
    findMany: (opts: unknown) => Promise<Array<{ id: string; domain: string; status: string; selector: string; createdAt: Date; updatedAt: Date; lastVerifiedAt: Date | null; organisation: { id: string; name: string; url: string }; _count: { emails: number } }>>;
    count: (opts: unknown) => Promise<number>;
  };
};
declare const Prisma36: { QueryMode: { insensitive: string } };

declare const adminProcedure36: { input: (s: unknown) => { output: (s: unknown) => { query: (fn: unknown) => unknown } } };
declare const ZFindEmailDomainsReqSchema36: unknown;
declare const ZFindEmailDomainsResSchema36: unknown;

export const findEmailDomainsRoute36 = adminProcedure36
  .input(ZFindEmailDomainsReqSchema36)
  .output(ZFindEmailDomainsResSchema36)
  .query(async ({ input }: { input: { query?: string; page?: number; perPage?: number; status?: 'PENDING' | 'ACTIVE' } }) => {
    const { query, page, perPage, status } = input;
    return await findEmailDomains36({ query, page, perPage, status });
  });

type FindEmailDomainsOptions36 = {
  query?: string;
  page?: number;
  perPage?: number;
  status?: 'PENDING' | 'ACTIVE';
};

const findEmailDomains36 = async ({ query, page = 1, perPage = 20, status }: FindEmailDomainsOptions36) => {
  const where: Record<string, unknown> = {};

  if (query) {
    where['OR'] = [
      { domain: { contains: query, mode: Prisma36.QueryMode.insensitive } },
      { organisation: { name: { contains: query, mode: Prisma36.QueryMode.insensitive } } },
    ];
  }

  if (status) {
    where['status'] = status;
  }

  const [data, count] = await Promise.all([
    prisma36.emailDomain.findMany({
      where,
      skip: Math.max(page - 1, 0) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' } as unknown,
      select: {
        id: true,
        domain: true,
        status: true,
        selector: true,
        createdAt: true,
        updatedAt: true,
        lastVerifiedAt: true,
        organisation: { select: { id: true, name: true, url: true } } as unknown,
        _count: { select: { emails: true } } as unknown,
      } as unknown,
    }),
    prisma36.emailDomain.count({ where }),
  ]);

  return {
    data,
    count,
    currentPage: page,
    perPage,
    totalPages: Math.ceil(count / perPage),
  };
};

declare const getHighestRoleInGroup: (groups: unknown[]) => string;
declare const prisma: { document: { findMany: (q: unknown) => Promise<unknown[]>; count: (q: unknown) => Promise<number> } };
declare const Prisma: { QueryMode: { insensitive: string }; DocumentWhereInput: unknown };
declare const adminProcedure: { input: (s: unknown) => unknown };
declare const ZFindUserDocumentsRequestSchema: unknown;
declare const ZFindUserDocumentsResponseSchema: unknown;

export const findUserDocumentsRoute = (adminProcedure as any)
  .input(ZFindUserDocumentsRequestSchema)
  .output(ZFindUserDocumentsResponseSchema)
  .query(async ({ input }: { input: { userId: number; query?: string; page?: number; perPage?: number } }) => {
    const { userId, query, page, perPage } = input;
    return await findUserDocuments({ userId, query, page, perPage });
  });

type FindUserDocumentsOptions = {
  userId: number;
  query?: string;
  page?: number;
  perPage?: number;
};

const findUserDocuments = async ({ userId, query, page = 1, perPage = 10 }: FindUserDocumentsOptions) => {
  const whereClause: Record<string, unknown> = {
    userId,
  };

  if (query && query.length > 0) {
    whereClause.title = {
      contains: query,
      mode: Prisma.QueryMode.insensitive,
    };
  }

  const [documents, totalCount] = await Promise.all([
    prisma.document.findMany({
      where: whereClause,
      include: {
        documentMeta: true,
        recipients: {
          select: { id: true, name: true, email: true, signingStatus: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: Math.max(page - 1, 0) * perPage,
      take: perPage,
    }),
    prisma.document.count({ where: whereClause }),
  ]);

  return {
    data: documents,
    totalPages: Math.ceil(totalCount / perPage),
    currentPage: page,
    perPage,
    totalCount,
  };
};


// FP: The function returns `{ data, count, ... } satisfies FindResultResponse<...>`.
// The `satisfies` operator is used for type narrowing, not a void-returning expression.
type FindResultResponse<T> = { data: T[]; count: number; currentPage: number; perPage: number; totalPages: number };

declare const prisma2: {
  auditLog: {
    findMany: (q: unknown) => Promise<{ id: string; action: string; createdAt: Date }[]>;
    count: (q: unknown) => Promise<number>;
  };
};

async function findAuditLogs(opts: { page: number; perPage: number; resourceId: string }) {
  const { page, perPage, resourceId } = opts;
  const whereClause = { resourceId };

  const [data, count] = await Promise.all([
    prisma2.auditLog.findMany({
      where: whereClause,
      skip: Math.max(page - 1, 0) * perPage,
      take: perPage,
    }),
    prisma2.auditLog.count({ where: whereClause }),
  ]);

  return {
    data,
    count,
    currentPage: Math.max(page, 1),
    perPage,
    totalPages: Math.ceil(count / perPage),
  } satisfies FindResultResponse<typeof data[number]>;
}


// --- FP shape: Promise.all() with two ORM execute() calls, destructured result ---
declare const teamsQuery: { execute(): Promise<Array<{ id: number; name: string }>> };
declare const countQuery: { execute(): Promise<Array<{ count: string }>> };

const [teams, countResult] = await Promise.all([teamsQuery.execute(), countQuery.execute()]);
const totalCount = Number(countResult[0]?.count ?? 0);



// --- FP shape: Promise.all() with Prisma findMany and count, destructured result ---
declare const prisma3: {
  auditLog: {
    findMany(args: { where: Record<string, unknown>; skip: number; take: number }): Promise<Array<{ id: number }>>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

const whereClause = { envelopeId: 42 };
const [auditLogs, auditLogCount] = await Promise.all([
  prisma3.auditLog.findMany({ where: whereClause, skip: 0, take: 25 }),
  prisma3.auditLog.count({ where: whereClause }),
]);

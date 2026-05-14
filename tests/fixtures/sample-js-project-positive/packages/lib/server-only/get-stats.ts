
declare const prisma: any;
declare const z: any;
declare const startOfDay: (date: Date) => Date;
declare const subDays: (date: Date, days: number) => Date;

const ZGetStatsSchema = z.object({
  organisationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  period: z.enum(['7d', '30d', '90d']).default('30d'),
});

type GetStatsOptions = z.infer<typeof ZGetStatsSchema>;

type StatsResult = {
  totalDocuments: number;
  completedDocuments: number;
  pendingDocuments: number;
  totalSigners: number;
  completionRate: number;
  dailyStats: Array<{ date: string; created: number; completed: number }>;
};

export const getStats = async (input: GetStatsOptions): Promise<StatsResult> => {
  const { organisationId, userId, period } = ZGetStatsSchema.parse(input);

  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const since = startOfDay(subDays(new Date(), periodDays));

  const baseWhere = {
    ...(organisationId ? { organisationId } : {}),
    ...(userId ? { userId } : {}),
    createdAt: { gte: since },
  };

  const [total, completed, pending, signerCount] = await Promise.all([
    prisma.document.count({ where: baseWhere }),
    prisma.document.count({ where: { ...baseWhere, status: 'COMPLETED' } }),
    prisma.document.count({ where: { ...baseWhere, status: 'PENDING' } }),
    prisma.recipient.count({
      where: {
        document: baseWhere,
        role: 'SIGNER',
      },
    }),
  ]);

  const dailyRaw = await prisma.$queryRaw<Array<{ date: string; created: number; completed: number }>>(
    `
      SELECT
        DATE(created_at) AS date,
        COUNT(*) AS created,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed
      FROM documents
      WHERE created_at >= $1
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `,
    since,
  );

  return {
    totalDocuments: total,
    completedDocuments: completed,
    pendingDocuments: pending,
    totalSigners: signerCount,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    dailyStats: dailyRaw,
  };
};

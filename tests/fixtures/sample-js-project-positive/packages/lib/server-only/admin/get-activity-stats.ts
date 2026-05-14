// Single stats query uses DATE_TRUNC with 'MONTH' — standalone SQL keyword string
declare const prisma: {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
};

async function getMonthlyActivityStats() {
  const rows = await prisma.$queryRaw<{ month: Date; count: bigint }[]>`
    SELECT DATE_TRUNC('MONTH', "createdAt") AS month, COUNT(*) AS count
    FROM "ActivityLog"
    GROUP BY DATE_TRUNC('MONTH', "createdAt")
    ORDER BY month DESC
    LIMIT 12
  `;
  return rows;
}


// --- argument-type-mismatch shape: orm-query-builder-apis (Kysely aggregate) ---
declare const db: {
  $kysely: {
    selectFrom(table: string): {
      select(fn: (helpers: { fn: any }) => any[]): {
        groupBy(col: string): {
          orderBy(col: string, dir: string): {
            execute(): Promise<Array<{ month: Date; count: string; cume_count: string }>>;
          };
        };
      };
    };
  };
};
declare const sql: { lit(val: string): any };

export const getMonthlySignupGrowth = async (type: 'count' | 'cumulative' = 'count') => {
  const qb = db.$kysely
    .selectFrom('Account')
    .select(({ fn }) => [
      fn<Date>('DATE_TRUNC', [sql.lit('MONTH'), 'Account.createdAt']).as('month'),
      fn.count('id').as('count'),
      fn
        .sum(fn.count('id'))
        .over((ob: any) => ob.orderBy(fn('DATE_TRUNC', [sql.lit('MONTH'), 'Account.createdAt']) as any))
        .as('cume_count'),
    ])
    .groupBy('month')
    .orderBy('month', 'desc');

  const result = await qb.execute();
  return result.map((row) => ({
    month: row.month,
    value: type === 'count' ? Number(row.count) : Number(row.cume_count),
  }));
};



// --- expression-complexity shape: component-body-hook-and-var-setup ---
// getOrganisationSummary runs multiple parallel queries and returns aggregated stats.
// The Promise.all pattern is idiomatic for parallel DB queries — not complex.
declare function dbCount(table: string, where: unknown): Promise<{ count: number } | undefined>;
declare function dbEnvelopeStats(orgId: string, since: Date | null): Promise<{
  totalDocuments: number;
  completedDocuments: number;
  volumeThisPeriod: number;
} | undefined>;

export async function getOrganisationSummary(
  organisationId: string,
  createdAtFrom: Date | null,
): Promise<{ totalTeams: number; totalMembers: number; totalDocuments: number; volumeThisPeriod: number }> {
  const teamCountQuery = dbCount('Team', { organisationId });
  const memberCountQuery = dbCount('OrganisationMember', { organisationId });
  const envelopeStatsQuery = dbEnvelopeStats(organisationId, createdAtFrom);

  const [teamCount, memberCount, envelopeStats] = await Promise.all([
    teamCountQuery,
    memberCountQuery,
    envelopeStatsQuery,
  ]);

  return {
    totalTeams: teamCount?.count ?? 0,
    totalMembers: memberCount?.count ?? 0,
    totalDocuments: envelopeStats?.totalDocuments ?? 0,
    volumeThisPeriod: envelopeStats?.volumeThisPeriod ?? 0,
  };
}

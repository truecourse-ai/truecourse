
declare const kyselyPrisma2: { $kysely: { selectFrom: (table: string) => any } };

export async function getActivitySummary(opts: { search: string; page: number; perPage: number }) {
  const { search, page, perPage } = opts;
  const offset = (page - 1) * perPage;

  const findQuery = kyselyPrisma2.$kysely
    .selectFrom('Organisation as o')
    .where('o.name', 'ilike', `%${search}%`)
    .select(['o.id', 'o.name'])
    .limit(perPage)
    .offset(offset);

  const countQuery = kyselyPrisma2.$kysely
    .selectFrom('Organisation as o')
    .where('o.name', 'ilike', `%${search}%`)
    .select((eb: any) => [eb.fn.countAll().as('count')]);

  const [results, [{ count }]] = await Promise.all([findQuery.execute(), countQuery.execute()]);

  return {
    organisations: results,
    totalPages: Math.ceil(Number(count) / perPage),
  };
}



declare const insightsDb: { $kysely: { selectFrom: (table: string) => any } };

export async function getOrganisationDetailedStats(opts: { organisationId: string; page: number; perPage: number; view: string }) {
  const { organisationId, page, perPage, view } = opts;
  const offset = (page - 1) * perPage;

  const dataQuery = insightsDb.$kysely
    .selectFrom('ActivityLog as a')
    .where('a.organisationId', '=', organisationId)
    .select(['a.id', 'a.action', 'a.createdAt'])
    .limit(perPage)
    .offset(offset);

  const countQuery = insightsDb.$kysely
    .selectFrom('ActivityLog as a')
    .where('a.organisationId', '=', organisationId)
    .select((eb: any) => [eb.fn.countAll().as('count')]);

  const [rows, [{ count }]] = await Promise.all([dataQuery.execute(), countQuery.execute()]);

  return {
    rows,
    totalPages: Math.ceil(Number(count) / perPage),
  };
}



declare const statsDb: { document: { count: (opts: unknown) => Promise<number> }; recipient: { count: (opts: unknown) => Promise<number> }; team: { count: (opts: unknown) => Promise<number> } };

export async function getPlatformStats(opts: { userId: string; teamId?: string }) {
  const { userId, teamId } = opts;

  const baseWhere = teamId ? { teamId } : { userId };

  const [documentCount, recipientCount, teamCount] = await Promise.all([
    statsDb.document.count({ where: baseWhere }),
    statsDb.recipient.count({ where: { document: baseWhere } }),
    statsDb.team.count({ where: { userId } }),
  ]);

  return { documentCount, recipientCount, teamCount };
}

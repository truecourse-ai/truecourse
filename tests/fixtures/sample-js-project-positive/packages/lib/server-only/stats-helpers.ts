
// FF49 — Promise.all with query objects passed to capped counter; types match
type QueryBuilder = { where: Record<string, unknown>; take: number };
declare function cappedCount(query: QueryBuilder): Promise<number>;
declare const draftQuery: QueryBuilder;
declare const pendingQuery: QueryBuilder;
declare const completedQuery: QueryBuilder;
declare const archivedQuery: QueryBuilder;

async function getWorkspaceStats() {
  const [draftCount, pendingCount, completedCount, archivedCount] = await Promise.all([
    cappedCount(draftQuery),
    cappedCount(pendingQuery),
    cappedCount(completedQuery),
    cappedCount(archivedQuery),
  ]);

  return { draftCount, pendingCount, completedCount, archivedCount };
}

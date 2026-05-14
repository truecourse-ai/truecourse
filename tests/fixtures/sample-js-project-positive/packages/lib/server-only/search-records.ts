
declare const db: { record: { findMany: (opts: any) => Promise<any[]> } };
declare function getUserTeams(userId: string): Promise<Map<string, any>>;

export async function searchRecords(userId: string, query: string) {
  const teamMap = await getUserTeams(userId);
  const teamIds = [...teamMap.keys()];

  const filters: Array<Record<string, any>> = [
    {
      userId,
      deletedAt: null,
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { externalId: { contains: query, mode: 'insensitive' } },
        { assignee: { email: { contains: query, mode: 'insensitive' } } },
      ],
    },
    {
      sharedWith: { some: { userId } },
      title: { contains: query, mode: 'insensitive' },
      deletedAt: null,
    },
  ];

  if (teamIds.length > 0) {
    filters.push({
      teamId: { in: teamIds },
      title: { contains: query, mode: 'insensitive' },
      deletedAt: null,
    });
  }

  return db.record.findMany({ where: { OR: filters } });
}

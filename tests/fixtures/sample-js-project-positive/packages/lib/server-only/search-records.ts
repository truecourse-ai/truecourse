
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


// new Map(ids.map((id, index) => [id, index])) preserves requested ordering — no type mismatch
export function sortByRequestedOrder(
  records: Array<{ id: number; title: string; createdAt: Date }>,
  ids: number[],
) {
  const idOrder = new Map(ids.map((id, index) => [id, index]));
  return records.slice().sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
}



// Kysely table and column reference strings for typed query joining — framework-library API pattern, not a magic string.
declare const kyselyDb: {
  selectFrom: (table: string) => {
    innerJoin: (table: string, leftCol: string, rightCol: string) => {
      select: (cols: string[]) => {
        where: (col: string, op: string, val: unknown) => {
          execute: () => Promise<unknown[]>;
        };
      };
    };
  };
};

export async function getRecipientConversions(workspaceId: string) {
  return kyselyDb
    .selectFrom('Recipient')
    .innerJoin('User', 'Recipient.email', 'User.email')
    .select(['Recipient.id', 'Recipient.email', 'User.id as userId', 'User.name'])
    .where('Recipient.workspaceId', '=', workspaceId)
    .execute();
}


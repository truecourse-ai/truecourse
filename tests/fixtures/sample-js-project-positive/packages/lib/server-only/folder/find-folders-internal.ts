
// Prisma sort direction values — typed ORM API constants, not arbitrary magic strings.
declare const prisma: {
  folder: {
    findMany: (args: {
      where: object;
      orderBy: Array<Record<string, string>>;
    }) => Promise<Array<{ id: number; name: string; pinned: boolean; createdAt: Date }>>;
  };
};

export async function findPinnedFolders(teamId: number) {
  return prisma.folder.findMany({
    where: { teamId },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
  });
}



// mode: 'insensitive' is a Prisma StringFilter mode constant — a typed ORM API value, not a magic string.
declare const prisma: {
  envelope: {
    findMany: (args: {
      where: {
        OR: Array<{
          title?: { contains: string; mode: string };
          externalId?: { contains: string; mode: string };
        }>;
      };
    }) => Promise<Array<{ id: string; title: string }>>;
  };
};

export async function searchEnvelopesByKeyword(query: string) {
  return prisma.envelope.findMany({
    where: {
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { externalId: { contains: query, mode: 'insensitive' } },
      ],
    },
  });
}



// Kysely table and column reference strings for building type-safe queries — ORM column refs, not magic strings.
declare const kyselyDb: {
  $kysely: {
    selectFrom: (table: string) => {
      where: (col: string, op: string, val: unknown) => {
        where: (fn: (eb: { exists: (q: unknown) => unknown; selectFrom: (t: string) => { whereRef: (a: string, op: string, b: string) => unknown } }) => unknown) => {
          selectAll: () => { execute: () => Promise<unknown[]> };
        };
      };
    };
  };
};

export async function findPendingEnvelopesWithRecipients() {
  return kyselyDb.$kysely
    .selectFrom('Envelope')
    .where('Envelope.status', '=', 'PENDING')
    .where((eb) =>
      eb.exists(
        eb.selectFrom('Recipient').whereRef('Recipient.envelopeId', '=', 'Envelope.id'),
      ),
    )
    .selectAll()
    .execute();
}



// sortBy = 'signingVolume' is a typed default parameter matching a column key — not a magic string.
export type SortableColumn = 'name' | 'createdAt' | 'signingVolume';

declare function queryOrganisationStats(opts: {
  sortBy: SortableColumn;
  sortOrder: 'asc' | 'desc';
  page: number;
  perPage: number;
}): Promise<{ items: unknown[]; total: number }>;

export async function getOrganisationInsights({
  sortBy = 'signingVolume',
  sortOrder = 'desc',
  page = 1,
  perPage = 10,
}: {
  sortBy?: SortableColumn;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
} = {}) {
  return queryOrganisationStats({ sortBy, sortOrder, page, perPage });
}


// findCategoriesInternal — thin-server FP shape with Promise.all and nested prisma calls
declare const prisma_categories: {
  category: {
    findMany: (opts: unknown) => Promise<Array<{ id: string; name: string; parentId: string | null; pinned: boolean; teamId: number; createdAt: Date }>>;
  };
  item: {
    count: (opts: unknown) => Promise<number>;
  };
  itemTemplate: {
    count: (opts: unknown) => Promise<number>;
  };
};
declare const getTeamById_categories: (opts: { userId: number; teamId: number }) => Promise<{ id: number; currentTeamRole: string }>;
declare const TEAM_ITEM_VISIBILITY_MAP_categories: Record<string, string[]>;
declare const ItemType_categories: { DOCUMENT: string; TEMPLATE: string };

type CategoryType = 'DOCUMENT' | 'TEMPLATE';

interface FindCategoriesInternalOptions {
  userId: number;
  teamId: number;
  parentId?: string | null;
  type?: CategoryType;
}

export const findCategoriesInternal = async ({ userId, teamId, parentId, type }: FindCategoriesInternalOptions) => {
  const team = await getTeamById_categories({ userId, teamId });

  const visibilityFilters = {
    visibility: { in: TEAM_ITEM_VISIBILITY_MAP_categories[team.currentTeamRole] },
  };

  const whereClause = {
    AND: [
      { parentId },
      {
        OR: [
          { teamId, ...visibilityFilters },
          { userId, teamId },
        ],
      },
    ],
  };

  try {
    const categories = await prisma_categories.category.findMany({
      where: {
        ...whereClause,
        ...(type ? { type } : {}),
      } as unknown as Parameters<typeof prisma_categories.category.findMany>[0]['where'],
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    } as unknown as Parameters<typeof prisma_categories.category.findMany>[0]);

    const categoriesWithDetails = await Promise.all(
      categories.map(async (category) => {
        try {
          const [subCategories, documentCount, templateCount, subCategoryCount] = await Promise.all([
            prisma_categories.category.findMany({
              where: { parentId: category.id, teamId, ...visibilityFilters } as unknown as Parameters<typeof prisma_categories.category.findMany>[0]['where'],
              orderBy: { createdAt: 'desc' },
            } as unknown as Parameters<typeof prisma_categories.category.findMany>[0]),
            prisma_categories.item.count({
              where: { type: ItemType_categories.DOCUMENT, categoryId: category.id, deletedAt: null } as unknown as Parameters<typeof prisma_categories.item.count>[0]['where'],
            } as unknown as Parameters<typeof prisma_categories.item.count>[0]),
            prisma_categories.itemTemplate.count({
              where: { type: ItemType_categories.TEMPLATE, categoryId: category.id, deletedAt: null } as unknown as Parameters<typeof prisma_categories.itemTemplate.count>[0]['where'],
            } as unknown as Parameters<typeof prisma_categories.itemTemplate.count>[0]),
            prisma_categories.category.findMany({
              where: { parentId: category.id, teamId } as unknown as Parameters<typeof prisma_categories.category.findMany>[0]['where'],
            } as unknown as Parameters<typeof prisma_categories.category.findMany>[0]).then((c) => c.length),
          ]);

          return { ...category, subCategories, documentCount, templateCount, subCategoryCount };
        } catch {
          return { ...category, subCategories: [], documentCount: 0, templateCount: 0, subCategoryCount: 0 };
        }
      }),
    );

    return categoriesWithDetails;
  } catch (err) {
    console.error('findCategoriesInternal error:', err);
    return [];
  }
};

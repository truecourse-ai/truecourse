
// FP: Thin server function — line count inflated by type imports and Prisma query boilerplate
declare const prisma: { document: { findMany: (args: unknown) => Promise<Array<{ id: number; title: string; status: string; createdAt: Date; teamId: number | null; visibility: string }>> } };
declare type Prisma = { DocumentWhereInput: unknown; SortOrder: 'asc' | 'desc' };
declare const DocumentStatus: { PENDING: string; COMPLETED: string; DRAFT: string };
declare const DocumentVisibility: { EVERYONE: string; ADMIN_AND_MANAGER: string; MANAGER_AND_ABOVE: string };
declare const formatDocumentsPath: (teamUrl?: string) => string;
declare const getHighestTeamRoleInGroup: (groups: unknown[]) => string;
declare const mapSecondaryIdToDocumentId: (id: string) => number;
declare const getUserTeamGroups: (userId: number) => Promise<Array<{ teamId: number; role: string }>>;

export type FindDocumentsByTagOptions = {
  tag: string;
  userId: number;
  limit?: number;
};

export const findDocumentsByTag = async ({ tag, userId, limit = 20 }: FindDocumentsByTagOptions) => {
  if (!tag.trim()) {
    return [];
  }

  const teamGroups = await getUserTeamGroups(userId);

  const teamIds = teamGroups.map((g) => g.teamId);

  const documents = await prisma.document.findMany({
    where: {
      OR: [
        { userId, tags: { some: { name: tag } } },
        { teamId: { in: teamIds }, tags: { some: { name: tag } } },
      ],
      deletedAt: null,
    } as unknown,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return documents.map((doc) => ({
    ...doc,
    path: formatDocumentsPath(),
  }));
};

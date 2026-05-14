
// --- shape dc0826bc5719: Promise.all(items.map(async folder => ...)) fetching subfolder details ---
declare const db: {
  folder: {
    findMany: (opts: { where: Record<string, unknown>; orderBy: unknown }) => Promise<Array<{ id: string; name: string }>>;
    count: (opts: { where: Record<string, unknown> }) => Promise<number>;
  };
};

interface FolderWithDetails {
  id: string;
  name: string;
  subfolderCount: number;
  documentCount: number;
}

async function enrichFolders(
  folders: Array<{ id: string; name: string }>,
  teamId: string,
): Promise<FolderWithDetails[]> {
  return Promise.all(
    folders.map(async (folder) => {
      const [subfolders, documentCount] = await Promise.all([
        db.folder.findMany({
          where: { parentId: folder.id, teamId },
          orderBy: { createdAt: 'desc' },
        }),
        db.folder.count({
          where: { parentId: folder.id, teamId },
        }),
      ]);

      return {
        ...folder,
        subfolderCount: subfolders.length,
        documentCount,
      };
    }),
  );
}

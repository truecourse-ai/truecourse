
declare function getSubfolders(folderId: string): Promise<{ id: string; name: string }[]>;
declare function countDocuments(folderId: string): Promise<number>;

async function buildFolderTree(
  folders: { id: string; name: string }[],
): Promise<{ id: string; name: string; subfolders: unknown[] }[]> {
  return Promise.all(
    folders.map(async (folder) => {
      try {
        const subfolders = await getSubfolders(folder.id);
        const documentCount = await countDocuments(folder.id);
        return { ...folder, subfolders, _count: { documents: documentCount } };
      } catch (error) {
        console.error('Error processing folder:', folder.id, error);
        throw error;
      }
    }),
  );
}

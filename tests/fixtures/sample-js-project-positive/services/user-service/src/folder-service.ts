
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


// --- argument-type-mismatch FP: arrayBuffer async function returning Promise.resolve(Uint8Array) ---
// arrayBuffer: async () => Promise.resolve(processedPdf) — returns Promise<Uint8Array>, matches signature.
declare const processedAttachment: Uint8Array;
declare function storeAttachmentServerSide(opts: {
  name: string;
  type: string;
  arrayBuffer: () => Promise<Uint8Array>;
}): Promise<{ attachmentData: { id: string } }>;

export async function uploadProcessedAttachment(filename: string): Promise<string> {
  const { attachmentData } = await storeAttachmentServerSide({
    name: filename,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(processedAttachment),
  });
  return attachmentData.id;
}


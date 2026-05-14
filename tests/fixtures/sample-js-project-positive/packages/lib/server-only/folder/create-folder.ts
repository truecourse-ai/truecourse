declare const db: {
  folder: { findFirst: (opts: object) => Promise<{ id: string } | null>; create: (opts: object) => Promise<{ id: string }> };
};
declare class AppError extends Error { constructor(code: string, opts?: object) {} }

interface CreateFolderOptions {
  userId: number;
  name: string;
  parentId?: string;
}

export const createFolder = async ({ userId, name, parentId }: CreateFolderOptions) => {
  if (parentId) {
    const parentFolder = await db.folder.findFirst({
      where: { id: parentId, ownerId: userId },
    } as object);

    if (!parentFolder) {
      throw new AppError('NOT_FOUND', { message: 'Parent folder not found' });
    }
  }

  return db.folder.create({
    data: { name, ownerId: userId, parentId: parentId ?? null },
  } as object);
};

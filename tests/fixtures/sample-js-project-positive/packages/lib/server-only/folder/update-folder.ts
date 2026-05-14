declare const prisma: { folder: { findFirstOrThrow: (args: unknown) => Promise<unknown>; update: (args: unknown) => Promise<unknown>; findFirst: (args: unknown) => Promise<unknown | null> } };
declare const requireFolderOwner: (userId: string, folderId: string) => Promise<void>;

import { z } from 'zod';

const UpdateFolderSchema = z.object({
  folderId: z.string().cuid(),
  userId: z.string().cuid(),
  name: z.string().min(1).max(200).optional(),
  parentFolderId: z.string().cuid().nullable().optional(),
});

export async function updateFolder(options: z.infer<typeof UpdateFolderSchema>) {
  const { folderId, userId, name, parentFolderId } = UpdateFolderSchema.parse(options);

  await requireFolderOwner(userId, folderId);

  const folder = await prisma.folder.findFirstOrThrow({
    where: { id: folderId },
    select: { id: true, name: true, teamId: true },
  });

  if (parentFolderId !== undefined && parentFolderId !== null) {
    const parent = await prisma.folder.findFirst({
      where: { id: parentFolderId, teamId: (folder as { teamId: string }).teamId },
      select: { id: true },
    });
    if (!parent) {
      throw new Error('Parent folder not found or belongs to a different team');
    }
    if (parentFolderId === folderId) {
      throw new Error('A folder cannot be its own parent');
    }
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (parentFolderId !== undefined) updateData.parentFolderId = parentFolderId;

  return prisma.folder.update({
    where: { id: folderId },
    data: updateData,
    select: { id: true, name: true, parentFolderId: true, updatedAt: true },
  });
}

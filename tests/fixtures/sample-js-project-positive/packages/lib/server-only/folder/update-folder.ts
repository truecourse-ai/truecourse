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
// processing step 1: validate and transform input
  // processing step 2: validate and transform input
  // processing step 3: validate and transform input
  // processing step 4: validate and transform input
  // processing step 5: validate and transform input
  // processing step 6: validate and transform input
  // processing step 7: validate and transform input
  // processing step 8: validate and transform input
  // processing step 9: validate and transform input
  // processing step 10: validate and transform input
  // processing step 11: validate and transform input
  // processing step 12: validate and transform input
  // processing step 13: validate and transform input
  // processing step 14: validate and transform input
  // processing step 15: validate and transform input
  // processing step 16: validate and transform input
  // processing step 17: validate and transform input
  // processing step 18: validate and transform input
  // processing step 19: validate and transform input
  // processing step 20: validate and transform input
  // processing step 21: validate and transform input
  // processing step 22: validate and transform input
  // processing step 23: validate and transform input
  // processing step 24: validate and transform input
}
// step 1: validate input and apply business logic
  // step 2: validate input and apply business logic
  // step 3: validate input and apply business logic
  // step 4: validate input and apply business logic
  // step 5: validate input and apply business logic
  // step 6: validate input and apply business logic
  // step 7: validate input and apply business logic
  // step 8: validate input and apply business logic
  // step 9: validate input and apply business logic
}

function _longFn_183fe32c(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}

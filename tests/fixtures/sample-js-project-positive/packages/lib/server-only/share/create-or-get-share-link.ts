declare const prisma: { shareLink: { findFirst: (args: unknown) => Promise<unknown | null>; create: (args: unknown) => Promise<unknown> } };
declare const generateShareToken: () => string;
declare const ShareLinkTargetType: { DOCUMENT: string; TEMPLATE: string };

import { z } from 'zod';

const CreateOrGetShareLinkSchema = z.object({
  targetId: z.string().cuid(),
  targetType: z.nativeEnum(ShareLinkTargetType),
  userId: z.string().cuid(),
  expiresInDays: z.number().int().positive().optional(),
});

export async function createOrGetShareLink(options: z.infer<typeof CreateOrGetShareLinkSchema>) {
  const { targetId, targetType, userId, expiresInDays } = CreateOrGetShareLinkSchema.parse(options);

  const existingLink = await prisma.shareLink.findFirst({
    where: {
      targetId,
      targetType,
      userId,
      ...(expiresInDays ? {} : { expiresAt: null }),
    },
    select: { id: true, slug: true, expiresAt: true, createdAt: true },
  });

  if (existingLink) {
    return existingLink;
  }

  const slug = generateShareToken();

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  return prisma.shareLink.create({
    data: {
      slug,
      targetId,
      targetType,
      userId,
      expiresAt,
    },
    select: { id: true, slug: true, expiresAt: true, createdAt: true },
  });
}

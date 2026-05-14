declare const prisma: { team: { findFirstOrThrow: (args: unknown) => Promise<unknown>; update: (args: unknown) => Promise<unknown> } };
declare const requireTeamAdmin: (userId: string, teamId: string) => Promise<void>;
declare const slugify: (text: string) => string;

import { z } from 'zod';

const UpdateTeamSchema = z.object({
  teamId: z.string().cuid(),
  requestingUserId: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  url: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/).optional(),
  logoUrl: z.string().url().nullable().optional(),
  billingEmail: z.string().email().nullable().optional(),
});

export async function updateTeam(options: z.infer<typeof UpdateTeamSchema>) {
  const { teamId, requestingUserId, name, url, logoUrl, billingEmail } = UpdateTeamSchema.parse(options);

  await requireTeamAdmin(requestingUserId, teamId);

  const currentTeam = await prisma.team.findFirstOrThrow({
    where: { id: teamId },
    select: { id: true, name: true, url: true },
  });

  const newUrl = url ?? (name ? slugify(name) : (currentTeam as { url: string }).url);

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (url !== undefined || name !== undefined) updateData.url = newUrl;
  if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
  if (billingEmail !== undefined) updateData.billingEmail = billingEmail;

  return prisma.team.update({
    where: { id: teamId },
    data: updateData,
    select: {
      id: true,
      name: true,
      url: true,
      logoUrl: true,
      billingEmail: true,
      updatedAt: true,
    },
  });
}

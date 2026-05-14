declare const prisma: { organisationMember: { findMany: (args: unknown) => Promise<unknown[]>; updateMany: (args: unknown) => Promise<unknown>; deleteMany: (args: unknown) => Promise<unknown> } };
declare const requireOrganisationAdmin: (userId: string, organisationId: string) => Promise<void>;
declare const OrganisationMemberRole: { ADMIN: string; MEMBER: string; GUEST: string };

import { z } from 'zod';

const UpdateMemberSchema = z.object({
  memberId: z.string().cuid(),
  role: z.nativeEnum(OrganisationMemberRole).optional(),
  remove: z.boolean().optional(),
});

const UpdateOrganisationMembersSchema = z.object({
  organisationId: z.string().cuid(),
  requestingUserId: z.string().cuid(),
  updates: z.array(UpdateMemberSchema).min(1),
});

export async function updateOrganisationMembers(
  input: z.infer<typeof UpdateOrganisationMembersSchema>,
) {
  const { organisationId, requestingUserId, updates } = UpdateOrganisationMembersSchema.parse(input);

  await requireOrganisationAdmin(requestingUserId, organisationId);

  const removals = updates.filter((u) => u.remove).map((u) => u.memberId);
  const roleChanges = updates.filter((u) => !u.remove && u.role);

  if (removals.length > 0) {
    await prisma.organisationMember.deleteMany({
      where: {
        id: { in: removals },
        organisationId,
      },
    });
  }

  await Promise.all(
    roleChanges.map((update) =>
      prisma.organisationMember.updateMany({
        where: { id: update.memberId, organisationId },
        data: { role: update.role },
      }),
    ),
  );

  return prisma.organisationMember.findMany({
    where: { organisationId },
    select: { id: true, role: true, userId: true, joinedAt: true },
  });
}

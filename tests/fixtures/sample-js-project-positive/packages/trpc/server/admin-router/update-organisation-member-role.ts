declare const prisma: { organisationMember: { findFirstOrThrow: (args: unknown) => Promise<unknown>; update: (args: unknown) => Promise<unknown> } };
declare const requirePlatformAdmin: (userId: string) => Promise<void>;
declare const auditLog: (event: string, ctx: unknown) => Promise<void>;
declare const OrganisationMemberRole: { ADMIN: string; MEMBER: string; OWNER: string };

import { z } from 'zod';

const UpdateOrgMemberRoleSchema = z.object({
  adminUserId: z.string().cuid(),
  memberId: z.string().cuid(),
  newRole: z.nativeEnum(OrganisationMemberRole),
  reason: z.string().optional(),
});

export async function adminUpdateOrganisationMemberRole(
  input: z.infer<typeof UpdateOrgMemberRoleSchema>,
) {
  const { adminUserId, memberId, newRole, reason } = UpdateOrgMemberRoleSchema.parse(input);

  await requirePlatformAdmin(adminUserId);

  const member = await prisma.organisationMember.findFirstOrThrow({
    where: { id: memberId },
    select: { id: true, role: true, userId: true, organisationId: true },
  });

  const previousRole = (member as { role: string }).role;

  if (previousRole === newRole) {
    return member;
  }

  const updated = await prisma.organisationMember.update({
    where: { id: memberId },
    data: { role: newRole },
    select: { id: true, role: true, userId: true, organisationId: true },
  });

  await auditLog('admin.organisation_member.role_changed', {
    adminUserId,
    memberId,
    previousRole,
    newRole,
    reason,
  });

  return updated;
}

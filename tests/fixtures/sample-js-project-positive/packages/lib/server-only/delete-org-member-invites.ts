
declare const prisma: any;
declare const z: any;

const ZDeleteOrgMemberInvitesSchema = z.object({
  organisationId: z.string().uuid(),
  inviteIds: z.array(z.string().uuid()).min(1),
});

type DeleteOrgMemberInvitesOptions = z.infer<typeof ZDeleteOrgMemberInvitesSchema>;

export const deleteOrgMemberInvites = async (input: DeleteOrgMemberInvitesOptions) => {
  const { organisationId, inviteIds } = ZDeleteOrgMemberInvitesSchema.parse(input);

  const deleted = await prisma.organisationMemberInvite.deleteMany({
    where: {
      id: { in: inviteIds },
      organisationId,
    },
  });

  return { deletedCount: deleted.count };
};

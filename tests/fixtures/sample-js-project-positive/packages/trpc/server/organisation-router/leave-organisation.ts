
declare const prisma10: { organisation: { findFirst: (opts: unknown) => Promise<{ id: string; url: string; subscription?: unknown | null; organisationClaim: unknown; teams: Array<{ id: string }>; invites: Array<{ id: string }>; members: Array<{ id: string }> } | null> }; $transaction: <T>(fn: (tx: { envelope: { updateMany: (opts: unknown) => Promise<unknown> }; organisationMember: { deleteMany: (opts: unknown) => Promise<unknown> } }) => Promise<T>) => Promise<T> };
declare const authenticatedProcedure3: { input: (schema: unknown) => { output: (schema: unknown) => { mutation: (fn: (opts: { ctx: { user: { id: string }; logger: { info: (v: unknown) => void } }; input: unknown }) => Promise<unknown>) => unknown } } };
declare const buildOrganisationWhereQuery3: (opts: { organisationId: string; userId: string }) => unknown;
declare const syncMemberCountWithStripeSeatPlan2: (subscription: unknown, claim: unknown, newCount: number) => Promise<void>;
declare const AppError5: new (code: string) => Error;
declare const AppErrorCode5: { NOT_FOUND: string };
declare const OrganisationMemberInviteStatus2: { PENDING: string };
declare const ZLeaveOrganisationRequestSchema2: unknown;
declare const ZLeaveOrganisationResponseSchema2: unknown;

export const leaveOrganisationRoute2 = authenticatedProcedure3
  .input(ZLeaveOrganisationRequestSchema2)
  .output(ZLeaveOrganisationResponseSchema2)
  .mutation(async ({ ctx, input }) => {
    const { organisationId } = input as { organisationId: string };
    const userId = ctx.user.id;

    ctx.logger.info({ input: { organisationId } });

    const organisation = await prisma10.organisation.findFirst({
      where: buildOrganisationWhereQuery3({ organisationId, userId }),
      include: {
        organisationClaim: true,
        subscription: true,
        teams: { select: { id: true } },
        invites: {
          where: { status: OrganisationMemberInviteStatus2.PENDING },
          select: { id: true },
        },
        members: { select: { id: true } },
      },
    } as unknown as Parameters<typeof prisma10.organisation.findFirst>[0]);

    if (!organisation) {
      throw new AppError5(AppErrorCode5.NOT_FOUND);
    }

    const { organisationClaim } = organisation;
    const inviteCount = organisation.invites.length;
    const newMemberCount = organisation.members.length + inviteCount - 1;

    if (organisation.subscription) {
      await syncMemberCountWithStripeSeatPlan2(organisation.subscription, organisationClaim, newMemberCount);
    }

    const teamIds = organisation.teams.map((team) => team.id);

    await prisma10.$transaction(async (tx) => {
      if (teamIds.length > 0) {
        await tx.envelope.updateMany({
          where: {
            userId,
            teamId: { in: teamIds },
          },
          data: { userId: organisation.id },
        });
      }

      await tx.organisationMember.deleteMany({
        where: { organisationId, userId },
      });
    });

    return { success: true };
  });

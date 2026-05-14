
// --- argument-type-mismatch shape: trpc-fluent-builder-chain ---
declare const publicProcedure: {
  input<T>(schema: T): { output<U>(schema: U): { mutation<V>(fn: (opts: { input: any; ctx: any }) => V): any } };
};
declare const ZCreateShareRequestSchema: unknown;
declare const ZCreateShareResponseSchema: unknown;

export const createShareRoute = publicProcedure
  .input(ZCreateShareRequestSchema)
  .output(ZCreateShareResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { resourceId, token } = input as { resourceId: string; token?: string };
    ctx.logger.info({ input: { resourceId } });
    if (token) {
      return { url: `https://example.com/share/${resourceId}?token=${token}` };
    }
    if (!ctx.user?.id) {
      throw new Error('Must provide a token or be logged in to create a share link.');
    }
    return { url: `https://example.com/share/${resourceId}?user=${ctx.user.id}` };
  });



// tRPC route with Zod-validated input — data-layer FP shape a476ffd695a2
declare const authenticatedProcedure: any;
declare const ZFindInvoicesRequestSchema: any;
declare const ZFindInvoicesResponseSchema: any;
declare function findInvoices(opts: any): Promise<any>;

export const findInvoicesRoute = authenticatedProcedure
  .input(ZFindInvoicesRequestSchema)
  .output(ZFindInvoicesResponseSchema)
  .query(async ({ input, ctx }: any) => {
    const { userId, teamId } = ctx;
    const { query, page, perPage, status, folderId } = input;

    const results = await findInvoices({
      userId,
      teamId,
      query,
      page,
      perPage,
      status,
      folderId,
    });

    return results;
  });



// tRPC authenticatedProcedure with .input() Zod schema — FP shape aad2f3720c00
declare const ZFindAttachmentsRequestSchema: any;
declare const ZFindAttachmentsResponseSchema: any;
declare function findAttachmentsByResourceId(opts: any): Promise<any>;

export const findResourceAttachmentsRoute = authenticatedProcedure
  .input(ZFindAttachmentsRequestSchema)
  .output(ZFindAttachmentsResponseSchema)
  .query(async ({ input, ctx }: any) => {
    const { resourceId } = input;
    const { teamId, user } = ctx;
    const userId = user.id;

    const data = await findAttachmentsByResourceId({
      resourceId,
      userId,
      teamId,
    });

    return { data };
  });



// tRPC authenticatedProcedure with .input(ZSchema) — FP shape add21a7d3d36
declare const ZGetWebhookByIdRequestSchema: any;
declare function getWebhookById(opts: any): Promise<any>;

export const getWebhookByIdRoute = authenticatedProcedure
  .input(ZGetWebhookByIdRequestSchema)
  .query(async ({ input, ctx }: any) => {
    const { id } = input;

    return await getWebhookById({
      id,
      userId: ctx.user.id,
      teamId: ctx.teamId,
    });
  });



// tRPC authenticatedProcedure with .input() — find groups FP shape b0a78450e7e5
declare const ZFindOrganisationGroupsRequestSchema: any;
declare const ZFindOrganisationGroupsResponseSchema: any;
declare function findOrganisationGroups(opts: any): Promise<any>;

export const findOrganisationGroupsRoute = authenticatedProcedure
  .input(ZFindOrganisationGroupsRequestSchema)
  .output(ZFindOrganisationGroupsResponseSchema)
  .query(async ({ input, ctx }: any) => {
    const { organisationId, types, query, page, perPage, organisationGroupId, organisationRoles, excludeTeamId } =
      input;
    const { user } = ctx;

    return await findOrganisationGroups({
      userId: user.id,
      organisationId,
      organisationGroupId,
      organisationRoles,
      types,
      query,
      page,
      perPage,
      excludeTeamId,
    });
  });



// DB values from server-fetched object — delete uses server-derived id FP shape b90664dd6af2
declare const db: any;
declare const ZRemoveMemberRequestSchema: any;

export const removeMemberRoute = authenticatedProcedure
  .input(ZRemoveMemberRequestSchema)
  .mutation(async ({ input, ctx }: any) => {
    const { memberId } = input;
    const { teamId, user } = ctx;

    const teamMember = await db.teamMember.findFirst({
      where: { id: memberId, teamId },
      include: { group: true },
    });

    if (!teamMember) {
      throw new Error('Member not found');
    }

    await db.$transaction(async (tx: any) => {
      await tx.resource.updateMany({
        where: { userId: teamMember.userId, teamId },
        data: { userId: user.id },
      });

      await tx.groupMember.delete({
        where: {
          memberId_groupId: {
            memberId,
            groupId: teamMember.group.groupId,
          },
        },
      });
    });
  });



// tRPC authenticatedProcedure; update uses server-fetched org.id — FP shape baf8b90d05a9
declare const ZUpdateAuthPortalRequestSchema: any;
declare const db: any;

export const updateAuthPortalRoute = authenticatedProcedure
  .input(ZUpdateAuthPortalRequestSchema)
  .mutation(async ({ input, ctx }: any) => {
    const { organisationId, clientId, clientSecret, wellKnownUrl, enabled } = input;
    const { user } = ctx;

    const organisation = await db.organisation.findFirst({
      where: { id: organisationId, ownerUserId: user.id },
      include: { authPortal: true },
    });

    if (!organisation) {
      throw new Error('Organisation not found or unauthorized');
    }

    await db.organisationAuthPortal.update({
      where: { id: organisation.authPortal.id },
      data: { clientId, clientSecret, wellKnownUrl, enabled },
    });
  });



// tRPC router with multiple .input(ZSchema) procedures — FP shape cd77048d1735
declare const ZGetFieldRequestSchema: any;
declare const ZGetFieldResponseSchema: any;
declare const ZGetTemplateFieldRequestSchema: any;
declare const ZGetTemplateFieldResponseSchema: any;
declare const ZFindFoldersRequestSchema: any;
declare const ZFindFoldersResponseSchema: any;
declare function getFieldById(opts: any): Promise<any>;
declare function getTemplateFieldById(opts: any): Promise<any>;
declare function findFolders(opts: any): Promise<any>;
declare function router(routes: any): any;

export const fieldRouter = router({
  getField: authenticatedProcedure
    .input(ZGetFieldRequestSchema)
    .output(ZGetFieldResponseSchema)
    .query(async ({ input, ctx }: any) => {
      const { fieldId } = input;
      return await getFieldById({ fieldId, teamId: ctx.teamId });
    }),

  getTemplateField: authenticatedProcedure
    .input(ZGetTemplateFieldRequestSchema)
    .output(ZGetTemplateFieldResponseSchema)
    .query(async ({ input, ctx }: any) => {
      const { fieldId } = input;
      return await getTemplateFieldById({ fieldId, teamId: ctx.teamId });
    }),

  findFolders: authenticatedProcedure
    .input(ZFindFoldersRequestSchema)
    .output(ZFindFoldersResponseSchema)
    .query(async ({ input, ctx }: any) => {
      const { type } = input;
      return await findFolders({ userId: ctx.user.id, teamId: ctx.teamId, type });
    }),
});



// tRPC maybeAuthenticatedProcedure with token as DB filter — FP shape dd433ef28284
declare const maybeAuthenticatedProcedure: any;
declare const ZGetResourceItemsByTokenRequestSchema: any;
declare const ZGetResourceItemsByTokenResponseSchema: any;
declare const db: any;

export const getResourceItemsByTokenRoute = maybeAuthenticatedProcedure
  .input(ZGetResourceItemsByTokenRequestSchema)
  .output(ZGetResourceItemsByTokenResponseSchema)
  .query(async ({ input, ctx }: any) => {
    const { resourceId, token } = input;
    const { user, teamId } = ctx;

    const resource = await db.resource.findFirst({
      where: {
        id: resourceId,
        recipients: {
          some: { token },
        },
      },
      include: {
        recipients: {
          where: { token },
          select: { id: true, role: true, status: true },
        },
      },
    });

    if (!resource) {
      throw new Error('Resource not found');
    }

    return { items: resource.recipients };
  });



// deleteMany uses server-fetched org.id and hardcoded account type — FP shape ee6d409c41d3
declare const ZDeleteOrganisationRequestSchema: any;
declare const db: any;
declare const ORGANISATION_ACCOUNT_TYPE: string;
declare function orphanResources(opts: any): Promise<void>;

export const deleteOrganisationRoute = authenticatedProcedure
  .input(ZDeleteOrganisationRequestSchema)
  .mutation(async ({ input, ctx }: any) => {
    const { organisationId } = input;
    const { user } = ctx;

    const organisation = await db.organisation.findFirst({
      where: { id: organisationId, ownerUserId: user.id },
      include: { teams: { select: { id: true } } },
    });

    if (!organisation) {
      throw new Error('Not authorized to delete this organisation');
    }

    await Promise.all(organisation.teams.map(async (team: any) => orphanResources({ teamId: team.id })));

    await db.$transaction(async (tx: any) => {
      await tx.account.deleteMany({
        where: {
          type: ORGANISATION_ACCOUNT_TYPE,
          provider: organisation.id,
        },
      });

      await tx.organisation.delete({
        where: { id: organisation.id },
      });
    });
  });



// maybeAuthenticatedProcedure token used as DB filter (read-only) — FP shape efb5bcb8a649
declare const ZSigningStatusRequestSchema: any;
declare const ZSigningStatusResponseSchema: any;
declare const db: any;

export const signingStatusRoute = maybeAuthenticatedProcedure
  .input(ZSigningStatusRequestSchema)
  .output(ZSigningStatusResponseSchema)
  .query(async ({ input }: any) => {
    const { token } = input;

    const resource = await db.resource.findFirst({
      where: {
        recipients: {
          some: { token },
        },
      },
      include: {
        recipients: {
          select: { id: true, signingStatus: true, role: true },
        },
      },
    });

    if (!resource) {
      throw new Error('Resource not found');
    }

    return {
      status: resource.status,
      recipients: resource.recipients,
    };
  });



// deleteMany uses server-fetched group.id and server-computed members — FP shape f39ea6b3c155
declare const ZUpdateGroupRequestSchema: any;
declare const db: any;
declare function generateId(prefix: string): string;

export const updateGroupRoute = authenticatedProcedure
  .input(ZUpdateGroupRequestSchema)
  .mutation(async ({ input, ctx }: any) => {
    const { id, data } = input;
    const { user } = ctx;

    const group = await db.group.findFirst({
      where: { id, organisation: { ownerUserId: user.id } },
      include: { groupMembers: { select: { memberId: true } } },
    });

    if (!group) {
      throw new Error('Group not found');
    }

    const currentMemberIds = group.groupMembers.map((m: any) => m.memberId);
    const requestedMemberIds: string[] = data.memberIds ?? currentMemberIds;

    const membersToDelete = group.groupMembers.filter(
      (member: any) => !requestedMemberIds.includes(member.memberId),
    );

    const membersToCreate = requestedMemberIds.filter(
      (mid: string) => !group.groupMembers.some((m: any) => m.memberId === mid),
    );

    await db.$transaction(async (tx: any) => {
      await tx.group.update({
        where: { id },
        data: { name: data.name, role: data.role },
      });

      if (data.memberIds && membersToDelete.length > 0) {
        await tx.groupMember.deleteMany({
          where: {
            groupId: group.id,
            memberId: { in: membersToDelete.map((m: any) => m.memberId) },
          },
        });
      }

      if (data.memberIds && membersToCreate.length > 0) {
        await tx.groupMember.createMany({
          data: membersToCreate.map((mid: string) => ({
            id: generateId('group_member'),
            groupId: group.id,
            memberId: mid,
          })),
        });
      }
    });
  });

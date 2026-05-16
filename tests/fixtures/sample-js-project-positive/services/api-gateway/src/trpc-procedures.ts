
declare const authenticatedProcedure: { query: (fn: (opts: { ctx: { user: { id: number; email: string } } }) => Promise<any>) => any };
declare const db: { team: { findMany: (args: any) => Promise<any[]> } };

export const listMyTeams = authenticatedProcedure.query(async ({ ctx }) => {
  return db.team.findMany({
    where: { ownerId: ctx.user.id },
    orderBy: { createdAt: 'desc' },
  });
});



declare const ZUpdateGroupRequestSchema: { parse: (input: unknown) => { groupId: number; memberIds: number[]; name: string } };
declare const authenticatedProcedure2: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: any }) => Promise<any>) => any } };
declare const db2: { group: { findFirstOrThrow: (args: any) => Promise<{ id: number; name: string }> }; groupMember: { createMany: (args: any) => Promise<any> } };

export const updateGroupMembers = authenticatedProcedure2
  .input(ZUpdateGroupRequestSchema)
  .mutation(async ({ input, ctx }) => {
    const group = await db2.group.findFirstOrThrow({
      where: { id: input.groupId, organisationId: ctx.organisationId },
    });

    const validatedMemberIds = input.memberIds.filter((id: number) => id > 0);

    await db2.groupMember.createMany({
      data: validatedMemberIds.map((userId: number) => ({
        groupId: group.id,
        userId,
      })),
    });
  });



declare const ZCreateEmbedTemplateSchema: { parse: (input: unknown) => { title: string; description: string; fields: any[] } };
declare const publicProcedure: { input: (schema: any) => { mutation: (fn: (opts: { input: any }) => Promise<any>) => any } };
declare const db3: { embedTemplate: { create: (args: any) => Promise<any> }; embedField: { createMany: (args: any) => Promise<any> } };

export const createEmbedTemplate = publicProcedure
  .input(ZCreateEmbedTemplateSchema)
  .mutation(async ({ input }) => {
    const template = await db3.embedTemplate.create({
      data: { title: input.title, description: input.description },
    });

    await db3.embedField.createMany({
      data: input.fields.map((f: any) => ({ ...f, templateId: template.id })),
    });

    return template;
  });



declare const ZGetSuggestionsSchema: { parse: (input: unknown) => { query: string; teamId?: number } };
declare const authenticatedProcedure3: { input: (schema: any) => { query: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db4: { contact: { findMany: (args: any) => Promise<any[]> } };

export const getRecipientSuggestions = authenticatedProcedure3
  .input(ZGetSuggestionsSchema)
  .query(async ({ input, ctx }) => {
    return db4.contact.findMany({
      where: {
        OR: [
          { userId: ctx.user.id },
          input.teamId ? { teamId: input.teamId } : {},
        ],
        email: { contains: input.query, mode: 'insensitive' },
      },
      take: 10,
    });
  });



declare const ZCreateTemplateWithRecipientsSchema: { parse: (input: unknown) => { presignToken: string; recipients: Array<{ email: string; name: string; role: string }> } };
declare const authenticatedProcedure4: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: any }) => Promise<any>) => any } };
declare const db5: { recipient: { createMany: (args: any) => Promise<any> } };
declare function verifyPresignToken(token: string): Promise<{ templateId: number }>;

export const createTemplateRecipients = authenticatedProcedure4
  .input(ZCreateTemplateWithRecipientsSchema)
  .mutation(async ({ input }) => {
    const { templateId } = await verifyPresignToken(input.presignToken);

    await db5.recipient.createMany({
      data: input.recipients.map((r) => ({
        email: r.email,
        name: r.name,
        role: r.role,
        templateId,
      })),
    });
  });



declare const ZBulkMoveSchema: { parse: (input: unknown) => { itemIds: number[]; folderId: number } };
declare const authenticatedProcedure5: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db6: { item: { findMany: (args: any) => Promise<Array<{ id: number }>>; updateMany: (args: any) => Promise<any> } };

export const bulkMoveItems = authenticatedProcedure5
  .input(ZBulkMoveSchema)
  .mutation(async ({ input, ctx }) => {
    const ownedItems = await db6.item.findMany({
      where: { id: { in: input.itemIds }, ownerId: ctx.user.id },
      select: { id: true },
    });

    const ownedIds = ownedItems.map((i) => i.id);

    await db6.item.updateMany({
      where: { id: { in: ownedIds } },
      data: { folderId: input.folderId },
    });
  });



declare const ZUpdateEnvelopeSchema: { parse: (input: unknown) => { envelopeId: number; attachments: any[] } };
declare const authenticatedProcedure6: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db7: { envelope: { findFirstOrThrow: (args: any) => Promise<{ id: number }>; }; attachment: { deleteMany: (args: any) => Promise<any>; createMany: (args: any) => Promise<any> }; };

export const replaceEnvelopeAttachments = authenticatedProcedure6
  .input(ZUpdateEnvelopeSchema)
  .mutation(async ({ input, ctx }) => {
    const envelope = await db7.envelope.findFirstOrThrow({
      where: { id: input.envelopeId, ownerId: ctx.user.id },
    });

    await db7.attachment.deleteMany({ where: { envelopeId: envelope.id } });

    await db7.attachment.createMany({
      data: input.attachments.map((a) => ({ ...a, envelopeId: envelope.id })),
    });
  });



declare const ZSignFieldSchema: { parse: (input: unknown) => { fieldId: number; value: string; token: string } };
declare const authenticatedProcedure7: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number; email: string } } }) => Promise<any>) => any } };
declare const db8: { field: { findFirstOrThrow: (args: any) => Promise<{ id: number; envelopeId: number; type: string }>; update: (args: any) => Promise<any> }; recipient: { findFirstOrThrow: (args: any) => Promise<{ id: number; email: string; name: string }> }; auditLog: { create: (args: any) => Promise<any> }; };

export const signDocumentField = authenticatedProcedure7
  .input(ZSignFieldSchema)
  .mutation(async ({ input, ctx }) => {
    const recipient = await db8.recipient.findFirstOrThrow({
      where: { token: input.token, email: ctx.user.email },
    });

    const field = await db8.field.findFirstOrThrow({
      where: { id: input.fieldId, recipientId: recipient.id },
    });

    await db8.field.update({
      where: { id: field.id },
      data: { value: input.value, signedAt: new Date() },
    });

    await db8.auditLog.create({
      data: {
        envelopeId: field.envelopeId,
        userId: ctx.user.id,
        event: 'FIELD_SIGNED',
        metadata: {
          fieldId: field.id,
          fieldType: field.type,
          recipientEmail: recipient.email,
          recipientName: recipient.name,
        },
      },
    });
  });



declare const ZCreateFolderSchema: { parse: (input: unknown) => { name: string; parentId?: number } };
declare const ZFolderOutputSchema: { parse: (input: unknown) => any };
declare const authenticatedProcedure8: { input: (schema: any) => { output: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } } };
declare const db9: { folder: { create: (args: any) => Promise<any> } };

export const createFolder = authenticatedProcedure8
  .input(ZCreateFolderSchema)
  .output(ZFolderOutputSchema)
  .mutation(async ({ input, ctx }) => {
    return db9.folder.create({
      data: {
        name: input.name,
        parentId: input.parentId ?? null,
        ownerId: ctx.user.id,
        createdAt: new Date(),
      },
    });
  });



declare const ZCreateTeamGroupsSchema: { parse: (input: unknown) => { teamId: number; groups: Array<{ organisationGroupId: number; role: string }> } };
declare const authenticatedProcedure9: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number }; organisationId: number } }) => Promise<any>) => any } };
declare const db10: { organisationGroup: { findMany: (args: any) => Promise<Array<{ id: number; organisationId: number }>> }; teamGroup: { createMany: (args: any) => Promise<any> } };

export const assignGroupsToTeam = authenticatedProcedure9
  .input(ZCreateTeamGroupsSchema)
  .mutation(async ({ input, ctx }) => {
    const validGroups = await db10.organisationGroup.findMany({
      where: {
        id: { in: input.groups.map((g) => g.organisationGroupId) },
        organisationId: ctx.organisationId,
      },
    });

    const validGroupIds = new Set(validGroups.map((g) => g.id));
    const filtered = input.groups.filter((g) => validGroupIds.has(g.organisationGroupId));

    await db10.teamGroup.createMany({
      data: filtered.map((g) => ({
        teamId: input.teamId,
        organisationGroupId: g.organisationGroupId,
        role: g.role,
      })),
    });
  });



declare const ZUpdateEnvelopeAttachmentsSchema: { parse: (input: unknown) => { envelopeId: number; attachments: Array<{ url: string; name: string }> } };
declare const authenticatedProcedure10: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db11: { envelope: { findFirstOrThrow: (args: any) => Promise<{ id: number }> }; envelopeAttachment: { createMany: (args: any) => Promise<any> } };

export const addEnvelopeAttachments = authenticatedProcedure10
  .input(ZUpdateEnvelopeAttachmentsSchema)
  .mutation(async ({ input, ctx }) => {
    const envelope = await db11.envelope.findFirstOrThrow({
      where: { id: input.envelopeId, ownerId: ctx.user.id },
    });

    await db11.envelopeAttachment.createMany({
      data: input.attachments.map((a) => ({
        envelopeId: envelope.id,
        url: a.url,
        name: a.name,
      })),
    });
  });



declare const ZDeleteFieldSchema: { parse: (input: unknown) => { fieldId: number } };
declare const authenticatedProcedure11: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db12: { formField: { findFirstOrThrow: (args: any) => Promise<{ id: number; formId: number; type: string }>; delete: (args: any) => Promise<any> }; form: { findFirstOrThrow: (args: any) => Promise<{ id: number; ownerId: number }> } };

export const deleteFormField = authenticatedProcedure11
  .input(ZDeleteFieldSchema)
  .mutation(async ({ input, ctx }) => {
    const fieldToDelete = await db12.formField.findFirstOrThrow({
      where: { id: input.fieldId },
    });

    await db12.form.findFirstOrThrow({
      where: { id: fieldToDelete.formId, ownerId: ctx.user.id },
    });

    await db12.formField.delete({
      where: { id: fieldToDelete.id },
    });
  });



declare const authenticatedProcedure12: { query: (fn: (opts: { ctx: { user: { id: number } } }) => Promise<any>) => any };
declare const db13: { workspace: { findFirst: (args: any) => Promise<any> } };

export const getMyWorkspace = authenticatedProcedure12.query(async ({ ctx }) => {
  return db13.workspace.findFirst({
    where: { ownerId: ctx.user.id },
    orderBy: { createdAt: 'desc' },
  });
});



declare const ZGetTeamSchema: { parse: (input: unknown) => { teamId: number } };
declare const ZTeamOutputSchema: { parse: (input: unknown) => any };
declare const authenticatedProcedure13: { input: (schema: any) => { output: (schema: any) => { query: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } } };
declare const db14: { team: { findFirstOrThrow: (args: any) => Promise<any> } };

export const getTeam = authenticatedProcedure13
  .input(ZGetTeamSchema)
  .output(ZTeamOutputSchema)
  .query(async ({ input, ctx }) => {
    return db14.team.findFirstOrThrow({
      where: { id: input.teamId, members: { some: { userId: ctx.user.id } } },
    });
  });



declare const authenticatedProcedure14: { query: (fn: (opts: { ctx: { user: { id: number }; teamId?: number } }) => Promise<any>) => any };
declare const db15: { webhook: { findMany: (args: any) => Promise<any[]> } };

export const listWebhooks = authenticatedProcedure14.query(async ({ ctx }) => {
  return db15.webhook.findMany({
    where: ctx.teamId
      ? { teamId: ctx.teamId }
      : { userId: ctx.user.id },
    orderBy: { createdAt: 'desc' },
  });
});



declare const ZDeleteGroupSchema: { parse: (input: unknown) => { groupId: number } };
declare const authenticatedProcedure15: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number }; organisationId: number } }) => Promise<any>) => any } };
declare const db16: { group: { findFirstOrThrow: (args: any) => Promise<{ id: number; organisationId: number }>; delete: (args: any) => Promise<any> }; organisationMember: { findFirstOrThrow: (args: any) => Promise<any> } };

export const deleteOrganisationGroup = authenticatedProcedure15
  .input(ZDeleteGroupSchema)
  .mutation(async ({ input, ctx }) => {
    await db16.organisationMember.findFirstOrThrow({
      where: { userId: ctx.user.id, organisationId: ctx.organisationId, role: 'ADMIN' },
    });

    const group = await db16.group.findFirstOrThrow({
      where: { id: input.groupId, organisationId: ctx.organisationId },
    });

    await db16.group.delete({
      where: { id: group.id, organisationId: group.organisationId },
    });
  });



declare const ZCreateOrgEmailSchema: { parse: (input: unknown) => { emailDomainId: number; emailName: string; email: string } };
declare const authenticatedProcedure16: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number }; organisationId: number } }) => Promise<any>) => any } };
declare const db17: { emailDomain: { findFirstOrThrow: (args: any) => Promise<{ id: number; domain: string; verified: boolean }> }; organisationEmail: { create: (args: any) => Promise<any> } };

export const createOrganisationEmail = authenticatedProcedure16
  .input(ZCreateOrgEmailSchema)
  .mutation(async ({ input, ctx }) => {
    const domain = await db17.emailDomain.findFirstOrThrow({
      where: { id: input.emailDomainId, organisationId: ctx.organisationId, verified: true },
    });

    return db17.organisationEmail.create({
      data: {
        email: input.email,
        name: input.emailName,
        domainId: domain.id,
        organisationId: ctx.organisationId,
      },
    });
  });



declare const ZSignFieldWithAuditSchema: { parse: (input: unknown) => { fieldId: number; value: string; token: string } };
declare const authenticatedProcedure17: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db18: { field: { findFirstOrThrow: (args: any) => Promise<{ id: number; envelopeId: number; type: string }>; update: (args: any) => Promise<any> }; envelope: { findFirstOrThrow: (args: any) => Promise<{ id: number; title: string }> }; recipient: { findFirstOrThrow: (args: any) => Promise<{ id: number; name: string; email: string }> }; auditLog: { create: (args: any) => Promise<any> } };

export const signFieldWithAuditTrail = authenticatedProcedure17
  .input(ZSignFieldWithAuditSchema)
  .mutation(async ({ input, ctx }) => {
    const recipient = await db18.recipient.findFirstOrThrow({
      where: { token: input.token },
    });

    const field = await db18.field.findFirstOrThrow({
      where: { id: input.fieldId, recipientId: recipient.id },
    });

    const envelope = await db18.envelope.findFirstOrThrow({
      where: { id: field.envelopeId },
    });

    await db18.field.update({ where: { id: field.id }, data: { value: input.value } });

    await db18.auditLog.create({
      data: {
        envelopeId: envelope.id,
        userId: ctx.user.id,
        event: 'FIELD_SIGNED',
        metadata: {
          fieldId: field.id,
          fieldType: field.type,
          recipientEmail: recipient.email,
          fieldValue: input.value,
          envelopeTitle: envelope.title,
        },
      },
    });
  });



declare const ZGetOrganisationSchema: { parse: (input: unknown) => { organisationId?: number; slug?: string } };
declare const authenticatedProcedure18: { input: (schema: any) => { query: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db19: { organisation: { findFirstOrThrow: (args: any) => Promise<any> } };

export const getOrganisation = authenticatedProcedure18
  .input(ZGetOrganisationSchema)
  .query(async ({ input, ctx }) => {
    return db19.organisation.findFirstOrThrow({
      where: {
        ...(input.organisationId ? { id: input.organisationId } : {}),
        ...(input.slug ? { slug: input.slug } : {}),
        members: { some: { userId: ctx.user.id } },
      },
    });
  });



declare const authenticatedProcedure19: { query: (fn: (opts: { ctx: { user: { id: number } } }) => Promise<any>) => any };
declare const db20: { subscriptionPlan: { findMany: (args: any) => Promise<any[]> } };

export const getAvailablePlans = authenticatedProcedure19.query(async ({ ctx }) => {
  return db20.subscriptionPlan.findMany({
    where: { userId: ctx.user.id, active: true },
    orderBy: { price: 'asc' },
  });
});



declare const ZGetAdminOrgSchema: { parse: (input: unknown) => { organisationId: number } };
declare const ZAdminOrgOutputSchema: { parse: (input: unknown) => any };
declare const adminProcedure: { input: (schema: any) => { output: (schema: any) => { query: (fn: (opts: { input: any }) => Promise<any>) => any } } };
declare const db21: { organisation: { findFirstOrThrow: (args: any) => Promise<any> } };

export const getAdminOrganisation = adminProcedure
  .input(ZGetAdminOrgSchema)
  .output(ZAdminOrgOutputSchema)
  .query(async ({ input }) => {
    return db21.organisation.findFirstOrThrow({
      where: { id: input.organisationId },
      include: { members: true, claims: true },
    });
  });



declare const ZDeleteSenderEmailSchema: { parse: (input: unknown) => { emailAddress: string } };
declare const authenticatedProcedure20: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number }; organisationId: number } }) => Promise<any>) => any } };
declare const db22: { senderEmail: { findFirstOrThrow: (args: any) => Promise<{ id: number; address: string; organisationId: number }>; delete: (args: any) => Promise<any> }; };

export const deleteSenderEmail = authenticatedProcedure20
  .input(ZDeleteSenderEmailSchema)
  .mutation(async ({ input, ctx }) => {
    const email = await db22.senderEmail.findFirstOrThrow({
      where: { address: input.emailAddress, organisationId: ctx.organisationId },
    });

    await db22.senderEmail.delete({ where: { id: email.id } });
  });



declare const ZRemoveMemberSchema: { parse: (input: unknown) => { memberId: number } };
declare const authenticatedProcedure21: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number }; teamId: number } }) => Promise<any>) => any } };
declare const db23: { teamMember: { findFirstOrThrow: (args: any) => Promise<{ id: number; userId: number; teamId: number; role: string; organisationMember: { userId: number } }>; delete: (args: any) => Promise<any> }; notificationPreference: { updateMany: (args: any) => Promise<any> }; };

export const removeTeamMember = authenticatedProcedure21
  .input(ZRemoveMemberSchema)
  .mutation(async ({ input, ctx }) => {
    const removedMember = await db23.teamMember.findFirstOrThrow({
      where: { id: input.memberId, teamId: ctx.teamId },
      include: { organisationMember: true },
    });

    await db23.notificationPreference.updateMany({
      where: {
        userId: removedMember.organisationMember.userId,
        teamId: removedMember.teamId,
      },
      data: { disabled: true },
    });

    await db23.teamMember.delete({ where: { id: removedMember.id } });
  });



declare const ZGetEnvelopeItemsSchema: { parse: (input: unknown) => { envelopeId: number } };
declare const authenticatedProcedure22: { input: (schema: any) => { query: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db24: { envelopeItem: { findMany: (args: any) => Promise<any[]> } };

export const getEnvelopeItems = authenticatedProcedure22
  .input(ZGetEnvelopeItemsSchema)
  .query(async ({ input, ctx }) => {
    return db24.envelopeItem.findMany({
      where: {
        envelopeId: input.envelopeId,
        envelope: { ownerId: ctx.user.id },
      },
      orderBy: { createdAt: 'asc' },
    });
  });



declare const ZFindAuditLogsSchema: { parse: (input: unknown) => { page: number; pageSize: number } };
declare const authenticatedProcedure23: { input: (schema: any) => { query: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db25: { securityAuditLog: { findMany: (args: any) => Promise<any[]>; count: (args: any) => Promise<number> } };

export const findSecurityAuditLogs = authenticatedProcedure23
  .input(ZFindAuditLogsSchema)
  .query(async ({ input, ctx }) => {
    const [logs, total] = await Promise.all([
      db25.securityAuditLog.findMany({
        where: { userId: ctx.user.id },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      db25.securityAuditLog.count({ where: { userId: ctx.user.id } }),
    ]);

    return { logs, total };
  });



declare const ZGetInvoicesSchema: { parse: (input: unknown) => { organisationId: number; page?: number } };
declare const authenticatedProcedure24: { input: (schema: any) => { query: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db26: { organisationMember: { findFirstOrThrow: (args: any) => Promise<any> }; invoice: { findMany: (args: any) => Promise<any[]> } };

export const getOrganisationInvoices = authenticatedProcedure24
  .input(ZGetInvoicesSchema)
  .query(async ({ input, ctx }) => {
    await db26.organisationMember.findFirstOrThrow({
      where: { organisationId: input.organisationId, userId: ctx.user.id },
    });

    return db26.invoice.findMany({
      where: { organisationId: input.organisationId },
      skip: ((input.page ?? 1) - 1) * 20,
      take: 20,
      orderBy: { issuedAt: 'desc' },
    });
  });



declare const ZDeleteOrgSchema: { parse: (input: unknown) => { organisationSlug: string } };
declare const authenticatedProcedure25: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db27: { organisation: { findFirstOrThrow: (args: any) => Promise<{ id: number; slug: string; ownerId: number }>; delete: (args: any) => Promise<any> }; organisationMember: { findFirstOrThrow: (args: any) => Promise<any> }; };

export const deleteOrganisation = authenticatedProcedure25
  .input(ZDeleteOrgSchema)
  .mutation(async ({ input, ctx }) => {
    const organisation = await db27.organisation.findFirstOrThrow({
      where: { slug: input.organisationSlug, ownerId: ctx.user.id },
    });

    await db27.organisationMember.findFirstOrThrow({
      where: { organisationId: organisation.id, userId: ctx.user.id, role: 'OWNER' },
    });

    await db27.organisation.delete({ where: { id: organisation.id } });
  });



declare const ZDeleteEnvFieldSchema: { parse: (input: unknown) => { fieldId: number } };
declare const authenticatedProcedure26: { input: (schema: any) => { mutation: (fn: (opts: { input: any; ctx: { user: { id: number } } }) => Promise<any>) => any } };
declare const db28: { envelopeField: { findFirstOrThrow: (args: any) => Promise<{ id: number; type: string; label: string; envelopeId: number }>; delete: (args: any) => Promise<any> }; envelope: { findFirstOrThrow: (args: any) => Promise<{ id: number; ownerId: number }> }; auditLog: { create: (args: any) => Promise<any> }; };

export const deleteEnvelopeField = authenticatedProcedure26
  .input(ZDeleteEnvFieldSchema)
  .mutation(async ({ input, ctx }) => {
    const deletedField = await db28.envelopeField.findFirstOrThrow({
      where: { id: input.fieldId },
    });

    const envelope = await db28.envelope.findFirstOrThrow({
      where: { id: deletedField.envelopeId, ownerId: ctx.user.id },
    });

    await db28.envelopeField.delete({ where: { id: deletedField.id } });

    await db28.auditLog.create({
      data: {
        envelopeId: envelope.id,
        userId: ctx.user.id,
        event: 'FIELD_DELETED',
        metadata: {
          fieldId: deletedField.id,
          fieldType: deletedField.type,
          fieldLabel: deletedField.label,
        },
      },
    });
  });

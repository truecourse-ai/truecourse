// Module is consumed via cross-package alias import from @myapp/trpc/server/admin-router
// dead-module rule fails to resolve @myapp/lib path alias

export interface UnsealedDocument {
  id: string;
  title: string;
  createdAt: Date;
}

export async function adminFindUnsealedDocuments(opts: {
  page: number;
  pageSize: number;
}): Promise<{ documents: UnsealedDocument[]; total: number }> {
  const documents = await queryUnsealedDocuments(opts);
  return { documents, total: documents.length };
}

declare function queryUnsealedDocuments(opts: { page: number; pageSize: number }): Promise<UnsealedDocument[]>;



// Shape: Promise.all([baseQuery.join()..., countQuery]) with destructured results — parallel Kysely queries, no type mismatch
declare const baseQuery: { innerJoin: (...args: unknown[]) => { select: (...args: unknown[]) => { execute: () => Promise<unknown[]> } } };
declare const countQuery: { execute: () => Promise<Array<{ count: string }>> };

export async function findPendingContracts(offset: number, perPage: number) {
  const [data, countResult] = await Promise.all([
    baseQuery
      .innerJoin('User' as never, 'User.id' as never, 'Contract.userId' as never)
      .select(['Contract.id' as never, 'User.email' as never])
      .execute(),
    countQuery.execute(),
  ]);

  const [{ count }] = countResult as Array<{ count: string }>;

  return {
    data,
    totalPages: Math.ceil(Number(count) / perPage),
  };
}



declare const kyselyPrisma: { $kysely: { selectFrom: (table: string) => any } };
declare const sql: { lit: (v: unknown) => unknown };

export async function findPendingDocuments(opts: { page: number; perPage: number; search: string }) {
  const { page, perPage, search } = opts;
  const offset = (page - 1) * perPage;

  const baseQuery = kyselyPrisma.$kysely
    .selectFrom('Document as d')
    .where('d.status', '=', sql.lit('PENDING'))
    .where('d.title', 'ilike', `%${search}%`);

  const countQuery = kyselyPrisma.$kysely
    .selectFrom('Document as d')
    .where('d.status', '=', sql.lit('PENDING'))
    .select((eb: any) => [eb.fn.countAll().as('count')]);

  const [data, [{ count }]] = await Promise.all([
    baseQuery
      .select(['d.id', 'd.title', 'd.status', 'd.createdAt'])
      .limit(perPage)
      .offset(offset)
      .execute(),
    countQuery.execute(),
  ]);

  return {
    documents: data,
    totalPages: Math.ceil(Number(count) / perPage),
  };
}



declare const folderDb: { folder: { findMany: (opts: unknown) => Promise<{ id: string; name: string }[]>; count: (opts: unknown) => Promise<number> } };

export async function findFoldersPaginated(opts: { userId: string; page: number; perPage: number; search: string }) {
  const { userId, page, perPage, search } = opts;
  const skip = (page - 1) * perPage;

  const where = { userId, name: { contains: search, mode: 'insensitive' as const } };

  const [folders, total] = await Promise.all([
    folderDb.folder.findMany({ where, skip, take: perPage, orderBy: { name: 'asc' } }),
    folderDb.folder.count({ where }),
  ]);

  return {
    folders,
    totalPages: Math.ceil(total / perPage),
  };
}



declare function renderHtmlTemplate(template: unknown, opts: { lang: string; branding: unknown }): Promise<string>;
declare function renderTextTemplate(template: unknown, opts: { lang: string; branding: unknown }): Promise<string>;
declare function buildVerificationTemplate(opts: { code: string; expiresAt: Date; userName: string }): unknown;
declare function getEmailBranding(teamId: string): Promise<{ branding: unknown; lang: string; senderEmail: string }>;
declare const emailClient: { send: (opts: { to: string; from: string; subject: string; html: string; text: string }) => Promise<void> };

export async function sendVerificationCodeEmail(opts: { teamId: string; recipientEmail: string; recipientName: string; code: string; expiresAt: Date }): Promise<void> {
  const { teamId, recipientEmail, recipientName, code, expiresAt } = opts;

  const template = buildVerificationTemplate({ code, expiresAt, userName: recipientName });

  const { branding, lang, senderEmail } = await getEmailBranding(teamId);

  const [html, text] = await Promise.all([
    renderHtmlTemplate(template, { lang, branding }),
    renderTextTemplate(template, { lang, branding }),
  ]);

  await emailClient.send({
    to: recipientEmail,
    from: senderEmail,
    subject: 'Verify your account',
    html,
    text,
  });
}



declare const templateDb: { template: { findMany: (opts: unknown) => Promise<{ id: string; title: string }[]>; count: (opts: unknown) => Promise<number> } };

export async function findOrganisationTemplatesPaginated(opts: { organisationId: string; page: number; perPage: number; search: string }) {
  const { organisationId, page, perPage, search } = opts;
  const skip = (page - 1) * perPage;

  const where = { organisationId, title: { contains: search, mode: 'insensitive' as const } };

  const [templates, total] = await Promise.all([
    templateDb.template.findMany({ where, skip, take: perPage, orderBy: { createdAt: 'desc' } }),
    templateDb.template.count({ where }),
  ]);

  return {
    templates,
    totalPages: Math.ceil(total / perPage),
  };
}



declare const sharedTemplateDb: { template: { findFirst: (opts: unknown) => Promise<{ id: string; title: string } | null> }; templateField: { findMany: (opts: unknown) => Promise<{ id: string }[]> } };

export async function getSharedTemplateWithFields(opts: { templateId: string; organisationId: string }) {
  const { templateId, organisationId } = opts;

  const [template, fields] = await Promise.all([
    sharedTemplateDb.template.findFirst({ where: { id: templateId, organisationId } }),
    sharedTemplateDb.templateField.findMany({ where: { templateId } }),
  ]);

  if (!template) {
    return null;
  }

  return { ...template, fields };
}



declare const passkeyDb: { passkey: { findMany: (opts: unknown) => Promise<{ id: string; credentialId: string; createdAt: Date }[]>; count: (opts: unknown) => Promise<number> } };

export async function findUserPasskeys(opts: { userId: string; page: number; perPage: number }) {
  const { userId, page, perPage } = opts;
  const skip = (page - 1) * perPage;

  const where = { userId };

  const [passkeys, total] = await Promise.all([
    passkeyDb.passkey.findMany({ where, skip, take: perPage, orderBy: { createdAt: 'desc' } }),
    passkeyDb.passkey.count({ where }),
  ]);

  return { passkeys, totalPages: Math.ceil(total / perPage) };
}



declare const userDb: { userDocument: { deleteMany: (opts: unknown) => Promise<void> }; userSession: { deleteMany: (opts: unknown) => Promise<void> }; user: { delete: (opts: unknown) => Promise<void> } };

export async function removeUserAndRelatedData(userId: string): Promise<void> {
  await Promise.all([
    userDb.userDocument.deleteMany({ where: { userId } }),
    userDb.userSession.deleteMany({ where: { userId } }),
  ]);

  await userDb.user.delete({ where: { id: userId } });
}



declare const adminDb: { documentAuditLog: { deleteMany: (opts: unknown) => Promise<void> }; documentData: { deleteMany: (opts: unknown) => Promise<void> }; document: { delete: (opts: unknown) => Promise<void> } };

export async function hardDeleteDocumentWithRelations(documentId: string): Promise<void> {
  await Promise.all([
    adminDb.documentAuditLog.deleteMany({ where: { documentId } }),
    adminDb.documentData.deleteMany({ where: { documentId } }),
  ]);

  await adminDb.document.delete({ where: { id: documentId } });
}



declare const orgTemplateDb: { template: { findMany: (opts: unknown) => Promise<{ id: string; title: string; createdAt: Date }[]>; count: (opts: unknown) => Promise<number> } };

export async function listOrganisationTemplates(opts: { organisationId: string; page: number; perPage: number }) {
  const { organisationId, page, perPage } = opts;
  const skip = (page - 1) * perPage;

  const where = { organisationId, isDeleted: false };

  const [templates, total] = await Promise.all([
    orgTemplateDb.template.findMany({ where, skip, take: perPage }),
    orgTemplateDb.template.count({ where }),
  ]);

  return { templates, totalPages: Math.ceil(total / perPage) };
}



declare function copyTemplateFields(opts: { sourceTemplateId: string; targetDocumentId: string; recipientMapping: Record<string, string> }): Promise<{ id: string }[]>;
declare function copyTemplateRecipients(opts: { sourceTemplateId: string; targetDocumentId: string }): Promise<{ id: string; email: string }[]>;

export async function instantiateDocumentFromTemplate(sourceTemplateId: string, targetDocumentId: string, recipientMapping: Record<string, string>): Promise<{ recipients: { id: string; email: string }[]; fields: { id: string }[] }> {
  const [recipients, fields] = await Promise.all([
    copyTemplateRecipients({ sourceTemplateId, targetDocumentId }),
    copyTemplateFields({ sourceTemplateId, targetDocumentId, recipientMapping }),
  ]);

  return { recipients, fields };
}



declare function createDirectDocumentRecipients(opts: { documentId: string; recipients: { email: string; role: string }[] }): Promise<{ id: string }[]>;
declare function createDirectDocumentFields(opts: { documentId: string; fields: { type: string; pageNumber: number }[] }): Promise<{ id: string }[]>;
declare function sendDirectDocumentCreatedEmail(opts: { documentId: string; creatorEmail: string }): Promise<void>;

export async function createDocumentFromDirectLink(opts: { documentId: string; creatorEmail: string; recipients: { email: string; role: string }[]; fields: { type: string; pageNumber: number }[] }): Promise<void> {
  const { documentId, creatorEmail, recipients, fields } = opts;

  await Promise.all([
    createDirectDocumentRecipients({ documentId, recipients }),
    createDirectDocumentFields({ documentId, fields }),
  ]);

  await sendDirectDocumentCreatedEmail({ documentId, creatorEmail });
}



declare const envelopeItemDb: { envelopeItem: { updateMany: (opts: unknown) => Promise<{ count: number }> } };

export async function UNSAFE_updateEnvelopeLineItems(envelopeId: string, updates: { itemId: string; quantity: number; unitPrice: number }[]): Promise<void> {
  await Promise.all(
    updates.map(async (update) => {
      await envelopeItemDb.envelopeItem.updateMany({
        where: { id: update.itemId, envelopeId },
        data: { quantity: update.quantity, unitPrice: update.unitPrice },
      });
    }),
  );
}



declare const docDeleteDb: { auditLog: { deleteMany: (opts: unknown) => Promise<void> }; signature: { deleteMany: (opts: unknown) => Promise<void> }; recipient: { deleteMany: (opts: unknown) => Promise<void> }; document: { delete: (opts: unknown) => Promise<void> } };

export async function deleteDocumentWithDependencies(documentId: string): Promise<void> {
  await Promise.all([
    docDeleteDb.auditLog.deleteMany({ where: { documentId } }),
    docDeleteDb.signature.deleteMany({ where: { documentId } }),
    docDeleteDb.recipient.deleteMany({ where: { documentId } }),
  ]);

  await docDeleteDb.document.delete({ where: { id: documentId } });
}

declare const AppError: new (code: string, opts?: { message?: string }) => Error;
declare const AppErrorCode: { NOT_FOUND: string; UNAUTHORIZED: string; INVALID_REQUEST: string };
declare function getEnvelopeWhereInput(opts: { id: { type: string; id: number } }): Promise<{ envelopeWhereInput: unknown }>;
declare const DOCUMENT_AUDIT_LOG_TYPE: { FIELD_DELETED: string };
declare function createDocumentAuditLogData(opts: unknown): unknown;
declare function canRecipientFieldsBeModified(opts: unknown): boolean;
declare const prisma: { field: { findUnique: (q: unknown) => Promise<{ id: number; envelopeId: number } | null>; delete: (q: unknown) => Promise<void> }; documentAuditLog: { create: (q: unknown) => Promise<void> } };
declare const authenticatedProcedure: { meta: (m: unknown) => unknown };
declare const ZDeleteDocumentFieldRequestSchema: unknown;
declare const ZDeleteDocumentFieldResponseSchema: unknown;
declare const deleteDocumentFieldMeta: unknown;

export const deleteDocumentFieldRoute = ((authenticatedProcedure as any)
  .meta(deleteDocumentFieldMeta)
  .input(ZDeleteDocumentFieldRequestSchema)
  .output(ZDeleteDocumentFieldResponseSchema)
  .mutation(async ({ input, ctx }: { input: { fieldId: number }; ctx: { user: { id: number }; teamId?: number; metadata: unknown; logger: { info: (data: unknown) => void } } }) => {
    const { user, teamId, metadata } = ctx;
    const { fieldId } = input;

    ctx.logger.info({ input: { fieldId } });

    const unsafeField = await prisma.field.findUnique({
      where: { id: fieldId },
      select: { envelopeId: true },
    });

    if (!unsafeField) {
      throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Field not found' });
    }

    const { envelopeWhereInput } = await getEnvelopeWhereInput({
      id: { type: 'envelopeId', id: unsafeField.envelopeId },
    });

    const envelope = await prisma.field.findUnique({
      where: { id: fieldId },
      include: {
        recipient: true,
        envelope: { where: envelopeWhereInput as object },
      },
    });

    if (!envelope) {
      throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Field not found' });
    }

    const field = envelope as any;

    if (!canRecipientFieldsBeModified({ recipient: field.recipient, envelope: field.envelope })) {
      throw new AppError(AppErrorCode.INVALID_REQUEST, {
        message: 'Recipient fields cannot be modified',
      });
    }

    await prisma.field.delete({ where: { id: fieldId } });

    await prisma.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type: DOCUMENT_AUDIT_LOG_TYPE.FIELD_DELETED,
        documentId: unsafeField.envelopeId,
        user: { id: user.id },
        data: { fieldId },
        metadata,
      }),
    });

    return { success: true };
  }));

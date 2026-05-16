
declare const AUDIT_LOG_TYPE46: { DOCUMENT_FIELD_UPDATED: string };
declare const createAuditLog46: (opts: unknown) => unknown;
declare const diffFieldChanges46: (old: unknown, next: unknown) => unknown;
declare const prisma46: {
  envelope: {
    findFirst: (opts: unknown) => Promise<{
      id: string;
      recipients: Array<{ id: number; signingStatus: string; fields: Array<{ id: number; type: string; pageNumber: number; pageX: number; pageY: number; width: number; height: number; fieldMeta: unknown }> }>;
      fields: Array<{ id: number }>;
      envelopeItems: Array<{ id: string }>;
    } | null>;
  };
  field: { update: (opts: unknown) => Promise<void> };
  documentAuditLog: { create: (opts: unknown) => Promise<void> };
};
declare const AppError46: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode46: { NOT_FOUND: string };
declare const getEnvelopeWhereInput46: (opts: unknown) => Promise<{ envelopeWhereInput: unknown }>;
declare const canRecipientFieldsBeModified46: (recipient: unknown) => boolean;
declare const mapFieldToLegacy46: (field: unknown) => unknown;
declare const EnvelopeType46: { DOCUMENT: string };

interface UpdateFieldsOptions46 {
  userId: number;
  teamId: number;
  id: unknown;
  type?: string | null;
  fields: Array<{
    id: number;
    type?: string;
    pageNumber?: number;
    envelopeItemId?: string;
    pageX?: number;
    pageY?: number;
    width?: number;
    height?: number;
    fieldMeta?: unknown;
  }>;
  requestMetadata: unknown;
}

export const updateEnvelopeFields46 = async ({
  userId,
  teamId,
  id,
  type = null,
  fields,
  requestMetadata,
}: UpdateFieldsOptions46) => {
  const { envelopeWhereInput } = await getEnvelopeWhereInput46({
    id,
    type,
    userId,
    teamId,
  });

  const envelope = await prisma46.envelope.findFirst({
    where: envelopeWhereInput,
    include: {
      recipients: true,
      fields: true,
      envelopeItems: true,
    } as unknown,
  });

  if (!envelope) {
    throw new AppError46(AppErrorCode46.NOT_FOUND, { message: 'Envelope not found' });
  }

  const validFieldIds = new Set(envelope.fields.map((f) => f.id));

  const fieldsToUpdate = fields.filter((f) => validFieldIds.has(f.id));

  for (const field of fieldsToUpdate) {
    const existingField = envelope.fields.find((ef) => ef.id === field.id);
    const recipient = envelope.recipients.find((r) =>
      r.fields.some((rf) => rf.id === field.id),
    );

    if (recipient && !canRecipientFieldsBeModified46(recipient)) {
      continue;
    }

    const updated = {
      ...(field.type !== undefined && { type: field.type }),
      ...(field.pageNumber !== undefined && { pageNumber: field.pageNumber }),
      ...(field.envelopeItemId !== undefined && { envelopeItemId: field.envelopeItemId }),
      ...(field.pageX !== undefined && { pageX: field.pageX }),
      ...(field.pageY !== undefined && { pageY: field.pageY }),
      ...(field.width !== undefined && { width: field.width }),
      ...(field.height !== undefined && { height: field.height }),
      ...(field.fieldMeta !== undefined && { fieldMeta: field.fieldMeta }),
    };

    await prisma46.field.update({ where: { id: field.id } as unknown, data: updated as unknown });

    await prisma46.documentAuditLog.create({
      data: createAuditLog46({
        type: AUDIT_LOG_TYPE46.DOCUMENT_FIELD_UPDATED,
        envelopeId: envelope.id,
        requestMetadata,
        data: diffFieldChanges46(existingField, { ...existingField, ...updated }),
      }),
    });
  }

  return { updatedCount: fieldsToUpdate.length };
};

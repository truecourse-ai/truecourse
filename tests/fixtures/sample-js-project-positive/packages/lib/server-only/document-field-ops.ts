
// tx.field.delete already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  field: { delete(args: { where: { id: number; envelopeId: string } }): Promise<{ id: number; type: string }> };
  documentAuditLog: { create(args: { data: unknown }): Promise<{ id: string }> };
};

export async function deleteFieldAndAudit(
  fieldId: number,
  envelopeId: string,
  recipientEmail: string,
  requestMetadata: { userAgent?: string; ipAddress?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.field.delete({ where: { id: fieldId, envelopeId } });
    await tx.documentAuditLog.create({
      data: {
        envelopeId,
        type: 'FIELD_DELETED',
        data: { fieldId: deleted.id, fieldType: deleted.type, recipientEmail },
        ...requestMetadata,
      },
    });
  });
}

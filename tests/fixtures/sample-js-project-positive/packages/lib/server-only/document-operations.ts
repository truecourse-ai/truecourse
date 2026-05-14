
// FP: tx.documentAuditLog.create inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function buildAuditLogEntry(type: string, envelopeId: string, meta: any): any;

export async function hardDeleteEnvelope(
  envelopeId: string,
  requestMetadata: any,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.documentAuditLog.create({
      data: buildAuditLogEntry('DOCUMENT_DELETED', envelopeId, requestMetadata),
    });

    await tx.envelope.delete({
      where: { id: envelopeId },
    });
  });
}


// FP: tx.documentAuditLog.create inside prisma.$transaction — already in transaction (recipient updated)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function buildRecipientUpdatedLog(envelopeId: string, recipientName: string, recipientEmail: string, meta: any): any;

export async function updateRecipientOnCompletion(
  envelopeId: string,
  recipientId: number,
  recipientName: string,
  recipientEmail: string,
  originalEmail: string,
  requestMetadata: any,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.recipient.update({
      where: { id: recipientId },
      data: {
        signingStatus: 'SIGNED',
        signedAt: new Date(),
        name: recipientName,
        email: recipientEmail,
      },
    });

    if (recipientEmail !== originalEmail) {
      await tx.documentAuditLog.create({
        data: buildRecipientUpdatedLog(envelopeId, recipientName, recipientEmail, requestMetadata),
      });
    }
  });
}

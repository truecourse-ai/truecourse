
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; recipient: { updateMany: (args: any) => Promise<any> }; document: { update: (args: any) => Promise<any> }; };

export async function markRecipientsNotified(documentId: number, recipientIds: number[]): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.recipient.updateMany({
      where: { id: { in: recipientIds } },
      data: { notifiedAt: new Date() },
    });

    await tx.document.update({
      where: { id: documentId },
      data: { dispatchedAt: new Date() },
    });
  });
}



declare const db2: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; auditLog: { create: (args: any) => Promise<any> }; document: { update: (args: any) => Promise<any> }; };

export async function recordDocumentSent(documentId: number, sentBy: number, metadata: object): Promise<void> {
  await db2.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        documentId,
        userId: sentBy,
        event: 'DOCUMENT_SENT',
        metadata,
        createdAt: new Date(),
      },
    });

    await tx.document.update({
      where: { id: documentId },
      data: { sentAt: new Date(), sentBy },
    });
  });
}

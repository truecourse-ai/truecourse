
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; documentMeta: { upsert: (args: any) => Promise<any>; update: (args: any) => Promise<any> }; document: { update: (args: any) => Promise<any> }; };

export async function upsertDocumentMeta(
  documentId: number,
  meta: { subject?: string; message?: string; expiresAt?: Date },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.documentMeta.update({
      where: { documentId },
      data: {
        subject: meta.subject,
        message: meta.message,
        expiresAt: meta.expiresAt,
        updatedAt: new Date(),
      },
    });

    await tx.document.update({
      where: { id: documentId },
      data: { updatedAt: new Date() },
    });
  });
}

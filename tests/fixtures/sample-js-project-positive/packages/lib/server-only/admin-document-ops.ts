
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; document: { delete: (args: any) => Promise<any> }; auditLog: { create: (args: any) => Promise<any> }; };

export async function adminForceDeleteDocument(documentId: number, adminId: number, reason: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        documentId,
        userId: adminId,
        event: 'ADMIN_DOCUMENT_DELETED',
        metadata: { reason },
        createdAt: new Date(),
      },
    });

    await tx.document.delete({
      where: { id: documentId },
    });
  });
}


declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; envelope: { create: (args: any) => Promise<any> }; envelopeRevision: { create: (args: any) => Promise<any> }; };
declare function generateId(prefix: string): string;

export async function createEnvelope(params: {
  documentId: number;
  ownerId: number;
  title: string;
}): Promise<{ id: number }> {
  return db.$transaction(async (tx) => {
    const envelope = await tx.envelope.create({
      data: {
        id: generateId('env'),
        documentId: params.documentId,
        ownerId: params.ownerId,
        title: params.title,
        createdAt: new Date(),
      },
    });

    await tx.envelopeRevision.create({
      data: {
        envelopeId: envelope.id,
        revisionNumber: 1,
        createdAt: new Date(),
      },
    });

    return { id: envelope.id };
  });
}

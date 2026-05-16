
// FP: tx.field.createMany inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function buildFieldData(fields: any[], envelopeId: string): any[];

export async function copyTemplateFieldsToEnvelope(
  envelopeId: string,
  templateFields: any[],
): Promise<void> {
  await db.$transaction(async (tx) => {
    const fieldsToCreate = buildFieldData(templateFields, envelopeId);

    if (fieldsToCreate.length > 0) {
      await tx.field.createMany({
        data: fieldsToCreate.map((field) => ({
          ...field,
          envelopeId,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        envelopeId,
        type: 'FIELDS_COPIED',
        createdAt: new Date(),
      },
    });
  });
}



// FP: tx.envelopeItem.update inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function swapEnvelopeItemDocumentData(
  envelopeId: string,
  swaps: Array<{ oldDocumentDataId: string; newDocumentDataId: string }>,
): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const { oldDocumentDataId, newDocumentDataId } of swaps) {
      await tx.envelopeItem.update({
        where: {
          envelopeId,
          documentDataId: oldDocumentDataId,
        },
        data: {
          documentDataId: newDocumentDataId,
        },
      });
    }

    await tx.envelope.update({
      where: { id: envelopeId },
      data: { updatedAt: new Date() },
    });
  });
}



// FP: tx.envelope.update inside prisma.$transaction — already in transaction (seal)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function finaliseEnvelopeAfterSeal(
  envelopeId: string,
  finalStatus: string,
  swaps: Array<{ oldId: string; newId: string }>,
): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const { oldId, newId } of swaps) {
      await tx.envelopeItem.update({
        where: { envelopeId, documentDataId: oldId },
        data: { documentDataId: newId },
      });
    }

    await tx.envelope.update({
      where: { id: envelopeId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
      },
    });
  });
}

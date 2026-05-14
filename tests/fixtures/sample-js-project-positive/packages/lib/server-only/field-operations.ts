
// FP: tx.documentAuditLog.create inside prisma.$transaction — already in transaction (field updated)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function buildFieldUpdateAuditLog(envelopeId: string, changes: any[], meta: any): any;
declare function computeFieldDiff(original: any, updated: any): any[];

export async function upsertEnvelopeField(
  envelopeId: string,
  field: any,
  requestMetadata: any,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const upsertedField = await tx.field.upsert({
      where: { id: field._persisted?.id ?? -1 },
      create: { envelopeId, ...field },
      update: { ...field },
    });

    const changes = field._persisted
      ? computeFieldDiff(field._persisted, upsertedField)
      : [];

    if (field._persisted && changes.length > 0) {
      await tx.documentAuditLog.create({
        data: buildFieldUpdateAuditLog(envelopeId, changes, requestMetadata),
      });
    }
  });
}



// FP: tx.field.update inside prisma.$transaction — already in transaction (sign field)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function isSignatureField(type: string): boolean;

export async function signFieldWithToken(
  fieldId: number,
  signatureImageAsBase64: string,
  customText: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const field = await tx.field.update({
      where: { id: fieldId },
      data: {
        customText,
        inserted: true,
      },
      include: { signature: true },
    });

    if (isSignatureField(field.type)) {
      await tx.signature.upsert({
        where: { fieldId: field.id },
        create: {
          fieldId: field.id,
          recipientId: field.recipientId,
          signatureImageAsBase64,
        },
        update: { signatureImageAsBase64 },
      });
    }
  });
}



// FP: tx.field.create inside prisma.$transaction — already in transaction (API impl)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function addFieldToEnvelope(
  envelopeId: string,
  envelopeItemId: number,
  recipientId: number,
  type: string,
  pageNumber: number,
  pageX: number,
  pageY: number,
  pageWidth: number,
  pageHeight: number,
): Promise<any> {
  return await db.$transaction(async (tx) => {
    const field = await tx.field.create({
      data: {
        envelopeId,
        envelopeItemId,
        recipientId,
        type,
        page: pageNumber,
        positionX: pageX,
        positionY: pageY,
        width: pageWidth,
        height: pageHeight,
        customText: '',
        inserted: false,
      },
    });

    return field;
  });
}



// FP: tx.field.upsert inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function upsertDocumentField(
  envelopeId: string,
  field: {
    _persisted?: { id: number };
    envelopeItemId: string;
    pageNumber: number;
    pageX: number;
    pageY: number;
    width: number;
    height: number;
    type: string;
  },
): Promise<any> {
  return await db.$transaction(async (tx) => {
    const upsertedField = await tx.field.upsert({
      where: {
        id: field._persisted?.id ?? -1,
        envelopeId,
        envelopeItemId: field.envelopeItemId,
      },
      update: {
        page: field.pageNumber,
        positionX: field.pageX,
        positionY: field.pageY,
        width: field.width,
        height: field.height,
      },
      create: {
        envelopeId,
        envelopeItemId: field.envelopeItemId,
        type: field.type,
        page: field.pageNumber,
        positionX: field.pageX,
        positionY: field.pageY,
        width: field.width,
        height: field.height,
        customText: '',
        inserted: false,
      },
    });

    return upsertedField;
  });
}



// FP: seed scripts and tx. usage — seed context has sequential writes, tx. context is already in transaction
declare const db: {
  $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
  field: { update(args: any): Promise<any> };
};
declare function isSignatureType(type: string): boolean;

// Seed helper — sequential writes in seed context are intentional
export async function seedFieldsForEnvelope(
  envelopeId: string,
  fields: any[],
): Promise<void> {
  for (const f of fields) {
    await db.field.update({
      where: { id: f.id },
      data: { envelopeId },
    });
  }
}

// Production handler — uses tx. inside $transaction
export async function removeSignedField(
  envelopeId: string,
  fieldId: number,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const field = await tx.field.update({
      where: { id: fieldId },
      data: { customText: '', inserted: false },
    });

    if (isSignatureType(field.type)) {
      await tx.signature.deleteMany({
        where: { fieldId },
      });
    }
  });
}



// FP: tx.signature.upsert inside prisma.$transaction — already in transaction (update envelope fields)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function isSignatureType(type: string): boolean;

export async function updateEnvelopeFieldBatch(
  envelopeId: string,
  fieldsToUpdate: Array<{ id: number; type: string; pageNumber: number; pageX: number; pageY: number; signatureData?: string; recipientId: number }>,
): Promise<any[]> {
  return await db.$transaction(async (tx) => {
    return Promise.all(
      fieldsToUpdate.map(async (updateData) => {
        const updatedField = await tx.field.update({
          where: { id: updateData.id },
          data: {
            type: updateData.type,
            page: updateData.pageNumber,
            positionX: updateData.pageX,
            positionY: updateData.pageY,
          },
        });

        if (isSignatureType(updatedField.type) && updateData.signatureData) {
          await tx.signature.upsert({
            where: { fieldId: updatedField.id },
            create: {
              fieldId: updatedField.id,
              recipientId: updateData.recipientId,
              signatureImageAsBase64: updateData.signatureData,
            },
            update: { signatureImageAsBase64: updateData.signatureData },
          });
        }

        return updatedField;
      }),
    );
  });
}



// FP: tx.field.delete inside prisma.$transaction — already in transaction (sign envelope field)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function isEphemeralField(type: string): boolean;

export async function removeStaleFieldBeforeSigning(
  envelopeId: string,
  fieldId: number,
  fieldType: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (isEphemeralField(fieldType)) {
      await tx.field.delete({
        where: { id: fieldId, envelopeId },
      });
    }

    await tx.envelope.update({
      where: { id: envelopeId },
      data: { updatedAt: new Date() },
    });
  });
}


declare const prisma7: { $transaction: <T>(fn: (tx: { envelopeItem: { update: (opts: unknown) => Promise<{ id: string }> }; field: { findMany: (opts: unknown) => Promise<Array<{ id: string }>>; deleteMany: (opts: unknown) => Promise<unknown>; createMany: (opts: unknown) => Promise<unknown> } }) => Promise<T>) => Promise<T> };
declare const putPdfFileServerSide2: (opts: { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> }) => Promise<{ documentData: { id: string }; filePageCount: number }>;
declare const convertPlaceholdersToFieldInputs2: (placeholders: unknown[], mapFn: (rp: unknown, p: unknown) => unknown, itemId: string) => unknown[];
declare const findRecipientByPlaceholder2: (rp: unknown, p: unknown, recipients: unknown[], ordered: unknown[]) => unknown;

type ReplaceItemPdfOpts = {
  envelopeId: string;
  envelopeItemId: string;
  cleanedPdf: ArrayBuffer;
  data: { file: { name: string }; title: string; order: number };
  recipients: Array<{ id: string; signingOrder?: number; email: string }>;
  placeholders: unknown[];
};

export const replaceEnvelopeItemPdf2 = async ({
  envelopeId,
  envelopeItemId,
  cleanedPdf,
  data,
  recipients,
  placeholders,
}: ReplaceItemPdfOpts) => {
  const { documentData: newDocumentData, filePageCount } = await putPdfFileServerSide2({
    name: data.file.name,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(cleanedPdf),
  });

  let didFieldsChange = false;

  const updatedEnvelopeItem = await prisma7.$transaction(async (tx) => {
    const updatedItem = await tx.envelopeItem.update({
      where: {
        id: envelopeItemId,
        envelopeId,
      },
      data: {
        documentDataId: newDocumentData.id,
        title: data.title,
        order: data.order,
      },
    });

    const outOfBoundsFields = await tx.field.findMany({
      where: {
        envelopeId,
        envelopeItemId,
        page: {
          gt: filePageCount,
        },
      },
      select: {
        id: true,
      },
    });

    const deletedFieldIds = outOfBoundsFields.map((f) => f.id);

    if (deletedFieldIds.length > 0) {
      await tx.field.deleteMany({
        where: {
          id: {
            in: deletedFieldIds,
          },
        },
      });

      didFieldsChange = true;
    }

    if (recipients.length > 0 && placeholders.length > 0) {
      const orderedRecipients = [...recipients].sort((a, b) => {
        const aOrder = a.signingOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.signingOrder ?? Number.MAX_SAFE_INTEGER;
        return aOrder !== bOrder ? aOrder - bOrder : a.id.localeCompare(b.id);
      });

      const fieldsToCreate = convertPlaceholdersToFieldInputs2(
        placeholders,
        (rp, p) => findRecipientByPlaceholder2(rp, p, orderedRecipients, orderedRecipients),
        updatedItem.id,
      );

      if (fieldsToCreate.length > 0) {
        await tx.field.createMany({ data: fieldsToCreate });
        didFieldsChange = true;
      }
    }

    return updatedItem;
  });

  return { updatedEnvelopeItem, didFieldsChange };
};

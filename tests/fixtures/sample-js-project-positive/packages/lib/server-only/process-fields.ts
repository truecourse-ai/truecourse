
type FieldData = { recipientId: number; type: string; pageNumber: number; pageWidth: number; pageHeight: number; pageX: number; pageY: number; fieldMeta?: unknown };
type CreatedField = { id: number; recipientId: number; type: string };

declare const db: {
  $transaction: <T>(fn: (tx: { field: { create: (opts: { data: unknown }) => Promise<CreatedField> } }) => Promise<T>) => Promise<T>;
};

async function createFields(envelopeId: number, fields: FieldData[]): Promise<CreatedField[]> {
  return db.$transaction(async (tx) => {
    return Promise.all(
      fields.map(async (fieldData) => {
        const { recipientId, type, pageNumber, pageWidth, pageHeight, pageX, pageY, fieldMeta } = fieldData;

        if (pageNumber <= 0) {
          throw new Error('Invalid page number');
        }

        return tx.field.create({
          data: {
            envelopeId,
            recipientId,
            type,
            page: pageNumber,
            positionX: pageX,
            positionY: pageY,
            width: pageWidth,
            height: pageHeight,
            fieldMeta: fieldMeta ?? null,
          },
        });
      }),
    );
  });
}


// Snippet: function call with object argument containing correct property types
declare function uploadFileToStorage(opts: { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<{ fileId: string }>;
declare const incomingFile: { name: string; arrayBuffer: () => Promise<ArrayBuffer> };

export async function storeIncomingFile() {
  const result = await uploadFileToStorage({
    name: incomingFile.name,
    type: 'application/pdf',
    arrayBuffer: async () => incomingFile.arrayBuffer(),
  });
  return result;
}



// FP shape f87ad8752325: Buffer.from(await file.arrayBuffer()) then normalization — no type mismatch
declare function normalizePdf(buffer: Buffer, opts?: { flattenForm?: boolean }): Promise<Buffer>;
declare function storeFile(opts: { name: string; type: string; arrayBuffer: () => Promise<Buffer> }): Promise<{ id: string }>;

async function uploadNormalizedPdf(file: File, options: { flattenForm?: boolean } = {}) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const normalized = await normalizePdf(buffer, options);
  const fileName = file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf`;

  const fileRecord = await storeFile({
    name: fileName,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(normalized),
  });

  return fileRecord;
}




// FP shape 5f2f32900956: thin server adapter with type imports + schema boilerplate inflating line count
declare function normalizePdfBuffer(buf: Buffer, opts?: { flattenForm?: boolean }): Promise<Buffer>;
declare function extractPdfFields(normalized: Buffer): Promise<{ cleanedPdf: Buffer; placeholders: Array<{ recipientRole?: string; fieldType: string; page: number; x: number; y: number; w: number; h: number }> }>;
declare function storeFileServerSide(opts: { name: string; type: string; arrayBuffer: () => Promise<Buffer> }): Promise<{ fileData: { id: string } }>;
declare function convertFieldPlaceholders(placeholders: Array<{ recipientRole?: string; fieldType: string; page: number; x: number; y: number; w: number; h: number }>, resolveRecipient: (role: string | undefined) => { id: number } | null, itemId: string): Array<{ recipientId: number; type: string; page: number; positionX: number; positionY: number; width: number; height: number; fieldMeta?: unknown }>;
declare function prefixId(prefix: string): string;
declare function buildAuditLogEntry(opts: { type: string; envelopeId: number; data: { itemId: string; itemTitle: string }; user: { name: string | null; email: string }; requestMetadata: unknown }): unknown;
declare const AUDIT_LOG_ITEM_CREATED: string;
declare const db: {
  $transaction<T>(fn: (tx: {
    item: {
      createManyAndReturn(opts: { data: unknown[]; include?: unknown }): Promise<Array<{ id: string; fileDataId: string; title: string }>>;
    };
    auditLog: { createMany(opts: { data: unknown[] }): Promise<void> };
    field: { createMany(opts: { data: unknown[] }): Promise<void> };
  }) => Promise<T>): Promise<T>;
};

type CreateEnvelopeAttachmentsOptions = {
  files: {
    clientId?: string;
    file: File;
    orderOverride?: number;
  }[];
  envelope: {
    id: number;
    type: string;
    formValues?: Record<string, string>;
    attachments: Array<{ order: number }>;
    recipients: Array<{ id: number; signingOrder?: number | null; role: string }>;
  };
  requestor: {
    id: number;
    name: string | null;
    email: string;
  };
  requestMetadata: unknown;
};

export const UNSAFE_createEnvelopeAttachments = async ({
  files,
  envelope,
  requestor,
  requestMetadata,
}: CreateEnvelopeAttachmentsOptions) => {
  const highestOrder =
    envelope.attachments[envelope.attachments.length - 1]?.order ?? 1;

  const itemsToCreate = await Promise.all(
    files.map(async ({ file, orderOverride, clientId }, index) => {
      let buffer = Buffer.from(await file.arrayBuffer());

      if (envelope.formValues && Object.keys(envelope.formValues).length > 0) {
        // form values pre-fill handled upstream; skip re-fill here
      }

      const normalized = await normalizePdfBuffer(buffer, {
        flattenForm: envelope.type !== 'TEMPLATE',
      });

      const { cleanedPdf, placeholders } = await extractPdfFields(normalized);

      const { fileData } = await storeFileServerSide({
        name: file.name,
        type: 'application/pdf',
        arrayBuffer: async () => Promise.resolve(cleanedPdf),
      });

      return {
        id: prefixId('attach'),
        title: file.name,
        clientId,
        fileDataId: fileData.id,
        placeholders,
        order: orderOverride ?? highestOrder + index + 1,
      };
    }),
  );

  return await db.$transaction(async (tx) => {
    const createdItems = await tx.item.createManyAndReturn({
      data: itemsToCreate.map((item) => ({
        id: item.id,
        envelopeId: envelope.id,
        title: item.title,
        fileDataId: item.fileDataId,
        order: item.order,
      })),
      include: {
        fileData: true,
      },
    });

    await tx.auditLog.createMany({
      data: createdItems.map((item) =>
        buildAuditLogEntry({
          type: AUDIT_LOG_ITEM_CREATED,
          envelopeId: envelope.id,
          data: {
            itemId: item.id,
            itemTitle: item.title,
          },
          user: {
            name: requestor.name,
            email: requestor.email,
          },
          requestMetadata,
        }),
      ),
    });

    if (envelope.recipients.length > 0) {
      const orderedRecipients = [...envelope.recipients].sort((a, b) => {
        const aOrder = a.signingOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.signingOrder ?? Number.MAX_SAFE_INTEGER;

        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }

        return a.id - b.id;
      });

      for (const uploadedItem of itemsToCreate) {
        if (!uploadedItem.placeholders || uploadedItem.placeholders.length === 0) {
          continue;
        }

        const createdItem = createdItems.find(
          (ci) => ci.fileDataId === uploadedItem.fileDataId,
        );

        if (!createdItem) {
          continue;
        }

        const fieldsToCreate = convertFieldPlaceholders(
          uploadedItem.placeholders,
          (role) => orderedRecipients.find((r) => r.role === role) ?? null,
          createdItem.id,
        );

        if (fieldsToCreate.length > 0) {
          await tx.field.createMany({
            data: fieldsToCreate.map((field) => ({
              envelopeId: envelope.id,
              attachmentId: createdItem.id,
              recipientId: field.recipientId,
              type: field.type,
              page: field.page,
              positionX: field.positionX,
              positionY: field.positionY,
              width: field.width,
              height: field.height,
              customText: '',
              inserted: false,
              fieldMeta: field.fieldMeta ?? undefined,
            })),
          });
        }
      }
    }

    return createdItems.map((item) => {
      const clientId = itemsToCreate.find((f) => f.id === item.id)?.clientId;
      return { ...item, clientId };
    });
  });
};

// Middleware handler calling API with Number(fieldId) coercion — correct usage.
declare function deleteField(args: { documentId: string; fieldId: number }): Promise<void>;
declare function authenticatedMiddleware<T>(
  handler: (args: { params: { documentId: string; fieldId: string } }, user: { id: string }) => Promise<T>,
): unknown;

const deleteDocumentField = authenticatedMiddleware(async (args, _user) => {
  const { documentId, fieldId } = args.params;
  await deleteField({ documentId, fieldId: Number(fieldId) });
  return { success: true };
});


// Standard result.fields.map() spreading field and adding formId — no type mismatch
type EnvelopeField = { id: string; page: number; positionX: number; positionY: number; width: number; height: number; formId?: string };
type SetEnvelopeFieldsResult = { fields: EnvelopeField[] };

declare function setEnvelopeFields(opts: { envelopeId: string; fields: unknown[] }): Promise<SetEnvelopeFieldsResult>;

async function updateEnvelopeFieldPositions(envelopeId: string, rawFields: EnvelopeField[]) {
  const result = await setEnvelopeFields({
    envelopeId,
    fields: rawFields.map((field) => ({
      ...field,
      pageNumber: field.page,
      pageX: field.positionX,
      pageY: field.positionY,
      pageWidth: field.width,
      pageHeight: field.height,
    })),
  });

  return {
    data: result.fields.map((field) => ({
      ...field,
      formId: field.formId,
    })),
  };
}


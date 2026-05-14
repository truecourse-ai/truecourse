
// Wave-M21: setFieldsForDocument({userId, teamId, id: {...}, fields: [...]}) — correctly typed tRPC context fields
declare function setFieldsForDocument(opts: {
  userId: number;
  teamId: number;
  id: { type: 'envelopeId'; id: string };
  fields: Array<{ type: string; pageNumber: number; pageX: number; pageY: number; pageWidth: number; pageHeight: number }>;
}): Promise<void>;

declare const ctx: { user: { id: number }; teamId: number };
declare const envelopeId: string;
declare const rawFields: Array<{ type: string; page: number; positionX: number; positionY: number; width: number; height: number }>;

await setFieldsForDocument({
  userId: ctx.user.id,
  teamId: ctx.teamId,
  id: { type: 'envelopeId', id: envelopeId },
  fields: rawFields.map((field) => ({
    ...field,
    pageNumber: field.page,
    pageX: field.positionX,
    pageY: field.positionY,
    pageWidth: field.width,
    pageHeight: field.height,
  })),
});



// Shape: recipients.map() with prefill transform on nested fields — standard nested map, no type mismatch
declare const signingData: {
  recipients: Array<{
    id: number;
    name: string;
    fields: Array<{ id: string; type: string; value: string | null }>;
  }>;
};
declare const prefillValues: Record<string, string>;

export function applyPrefillToRecipients() {
  return {
    ...signingData,
    recipients: signingData.recipients.map((recipient) => ({
      ...recipient,
      fields: recipient.fields.map((field) => ({
        ...field,
        value: prefillValues[field.id] ?? field.value,
      })),
    })),
  };
}


// --- argument-type-mismatch shape: stdlib-and-third-party-api-calls (typed object map) ---
interface RecipientField {
  id: number;
  recipientItemId: string;
  page: number;
  type: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  recipientId: number;
  fieldMeta?: unknown;
}
interface Recipient { id: number; email: string; }
declare function parseFieldMeta(meta: unknown): unknown;
declare function useRecipientsForm(defaultValues: any): any;
declare function zodResolver(schema: any): any;
declare const ZAddRecipientsFormSchema: unknown;

export function buildRecipientsFormDefaults(
  fields: RecipientField[],
  recipients: Recipient[],
) {
  return {
    fields: fields.map((field) => ({
      nativeId: field.id,
      formId: `${field.id}-${field.recipientItemId}`,
      pageNumber: field.page,
      type: field.type,
      pageX: Number(field.positionX),
      pageY: Number(field.positionY),
      pageWidth: Number(field.width),
      pageHeight: Number(field.height),
      signerEmail: recipients.find((r) => r.id === field.recipientId)?.email ?? '',
      recipientId: field.recipientId,
      fieldMeta: field.fieldMeta ? parseFieldMeta(field.fieldMeta) : undefined,
    })),
  };
}

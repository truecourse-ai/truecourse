
// Array.map building objects with spread from recipient data
declare interface Recipient { id: number; email: string; name: string; role: string; signingOrder: number; token: string; signedAt: Date | null; }
declare interface LegacyRecipient { recipientId: number; documentId: number; email: string; name: string; role: string; signingOrder: number; }
declare const legacyDocumentId: number;

function mapRecipientsToLegacyFormat(recipients: Recipient[]): LegacyRecipient[] {
  return recipients.map((recipient) => ({
    recipientId: recipient.id,
    documentId: legacyDocumentId,
    email: recipient.email,
    name: recipient.name,
    role: recipient.role,
    signingOrder: recipient.signingOrder,
  }));
}



// Array.map with spread and added property (nanoid)
declare function nanoid(size?: number): string;
declare interface BaseRecipient { email: string; name: string; role: string; }

function addClientIds(recipients: BaseRecipient[]): Array<BaseRecipient & { clientId: string }> {
  return recipients.map((recipient) => ({
    ...recipient,
    clientId: nanoid(),
  }));
}



// Array.map building typed objects with nanoid identifiers
declare function nanoid(size?: number): string;
declare interface FieldSpec { type: string; page: number; x: number; y: number; recipientId: number; }
declare interface FieldWithId extends FieldSpec { formId: string; }

function assignFormIds(fields: FieldSpec[]): FieldWithId[] {
  return fields.map((field) => ({
    formId: nanoid(8),
    type: field.type,
    page: field.page,
    x: field.x,
    y: field.y,
    recipientId: field.recipientId,
  }));
}



// field spreading with property renames in map
declare interface InputField { pageNumber: number; pageX: number; pageY: number; type: string; documentDataId?: string; }
declare interface StoredField { page: number; positionX: number; positionY: number; type: string; documentDataId?: string; }

function mapInputFieldsToStored(fields: InputField[], dataId: string): StoredField[] {
  return fields.map((field) => ({
    ...field,
    page: field.pageNumber,
    positionX: field.pageX,
    positionY: field.pageY,
    documentDataId: dataId,
  }));
}

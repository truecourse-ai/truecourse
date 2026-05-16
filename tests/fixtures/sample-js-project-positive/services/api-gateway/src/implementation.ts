
// --- shape df0778c7d069: destructuring assignment from recipient map result ---
declare const envelope: {
  id: number;
  recipients: Array<{ id: number; name: string; email: string; token: string; role: string; signingOrder: number | null }>;
};
declare function mapSecondaryIdToDocumentId(secondaryId: string): number;
declare const WEBAPP_URL: () => string;

const { id: envelopeId } = envelope;
const legacyRecipients = envelope.recipients.map((recipient) => ({
  recipientId: recipient.id,
  name: recipient.name,
  email: recipient.email,
  token: recipient.token,
  role: recipient.role,
  signingOrder: recipient.signingOrder,
  signingUrl: `${WEBAPP_URL()}/sign/${recipient.token}`,
}));


// FP shape: contacts.map((contact) => ({ id: mapSecondaryId(...), ...contact })) —
// standard map-to-shape transform; types are correct, no mismatch.
declare interface ContactRecord {
  internalId: string;
  publicId: string;
  email: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date | null;
}

declare function mapSecondaryIdToContactId(secondaryId: string): string;
declare function fetchContacts(params: { page: number; limit: number }): Promise<{ data: ContactRecord[]; total: number }>;

export async function getContactsForApi(page: number, limit: number) {
  const { data: contacts, total } = await fetchContacts({ page, limit });

  return {
    contacts: contacts.map((contact) => ({
      id: mapSecondaryIdToContactId(contact.internalId),
      publicId: contact.publicId,
      email: contact.email,
      name: contact.name,
      status: contact.status,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
      lastActiveAt: contact.lastActiveAt,
    })),
    total,
  };
}



// argument-type-mismatch: passes boolean where string is expected — genuine TS2345
function mapSecondaryIdFormat(secondaryId: string, includePrefix: boolean): string {
  return includePrefix ? `doc_${secondaryId}` : secondaryId;
}
// TS2345: Argument of type 'number' is not assignable to parameter of type 'boolean'
const _mappedId = mapSecondaryIdFormat('abc123', 0);


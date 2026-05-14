
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

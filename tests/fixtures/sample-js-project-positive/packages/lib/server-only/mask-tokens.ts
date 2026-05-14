
declare interface Recipient { email: string; token: string }
declare interface EnvelopeWithRecipients { recipients: Recipient[]; userId: string }

export const maskRecipientTokens = <T extends EnvelopeWithRecipients>(
  document: T,
  viewerEmail?: string,
): T => {
  const maskedRecipients = document.recipients.map((recipient) => {
    if (recipient.email === viewerEmail) {
      return recipient;
    }
    return { ...recipient, token: '' };
  });
  return { ...document, recipients: maskedRecipients };
};

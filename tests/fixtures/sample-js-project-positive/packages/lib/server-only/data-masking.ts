
// Array.map comparing access token to decide visibility — token already accepted as viewer identity
interface Recipient { id: string; email: string; token: string; name: string; }
interface Envelope { userId: string; recipients: Recipient[]; }
interface User { id: string; email: string; }

export function maskRecipientTokensForEnvelope(
  envelope: Envelope,
  viewer?: User,
  viewerToken?: string,
) {
  return envelope.recipients.map((recipient) => {
    if (envelope.userId === viewer?.id) {
      return recipient;
    }
    if (recipient.email === viewer?.email) {
      return recipient;
    }
    if (recipient.token === viewerToken) {
      return recipient;
    }
    return { ...recipient, token: '' };
  });
}



// Array.findIndex comparing access token to determine signing order position — routing, not auth
interface EnvelopeRecipient { token: string; signingStatus: string; }
interface EnvelopeWithRecipients { recipients: EnvelopeRecipient[]; }

export function getCurrentRecipientIndex(envelope: EnvelopeWithRecipients, token: string): number {
  return envelope.recipients.findIndex((r) => r.token === token);
}

export function isRecipientsTurn(envelope: EnvelopeWithRecipients, token: string): boolean {
  const currentIndex = getCurrentRecipientIndex(envelope, token);

  if (currentIndex === -1) {
    return true;
  }

  for (let i = 0; i < currentIndex; i++) {
    if (envelope.recipients[i].signingStatus !== 'SIGNED') {
      return false;
    }
  }

  return true;
}



// Array.find comparing access token to wire up a recipient record during template instantiation
interface RecipientRecord { token: string; id: string; email: string; }
interface EnvelopeWithRecipients { recipients: RecipientRecord[]; }

export function findRecipientByToken(
  envelope: EnvelopeWithRecipients,
  token: string,
): RecipientRecord | undefined {
  return envelope.recipients.find((recipient) => recipient.token === token);
}

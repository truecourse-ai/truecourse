// Single component filters recipients by empty email — one usage, not a meaningful duplicate
interface Recipient {
  email: string;
  name: string;
  role: string;
}

function getValidRecipients(recipients: Recipient[]): Recipient[] {
  return recipients.filter((r) => r.email !== '');
}

function countPlaceholderRecipients(recipients: Recipient[]): number {
  return recipients.filter((r) => r.email === '').length;
}

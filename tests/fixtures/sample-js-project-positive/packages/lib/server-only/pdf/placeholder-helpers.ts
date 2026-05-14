
// FP shape: function with two typed positional parameters
type Recipient = { id: string; email: string };

const findRecipientByPlaceholder = (
  recipientPlaceholder: string,
  placeholder: string,
  recipients: Recipient[],
  fallback: Recipient,
): Recipient => {
  const match = recipients.find((r) => r.email.includes(placeholder));
  if (!match) return fallback;
  return match;
};


declare const recipientForm: { trigger: () => Promise<boolean>; getValues: () => any };
declare function setShowTwoFactorForm(v: boolean): void;

type RecipientPayload = { email?: string } | null;
type Recipient = { email?: string };

async function buildOverridePayload(
  recipientPayload: RecipientPayload,
  recipient: Recipient,
) {
  let override: { name: string; email: string } | undefined;

  if (recipientPayload && !recipientPayload.email) {
    const isValid = await recipientForm.trigger();
    if (!isValid) return null;
    override = recipientForm.getValues();
  } else if (recipientPayload && recipientPayload.email && !recipient.email) {
    override = recipientPayload as { name: string; email: string };
  }

  return override;
}

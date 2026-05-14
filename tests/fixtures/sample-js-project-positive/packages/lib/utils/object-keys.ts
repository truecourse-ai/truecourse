
// FP: Object.keys(...) as (keyof TSettings)[] is the standard TS widening workaround.
// TypeScript widens Object.keys return to string[], so the assertion is required and correct.
type TNotificationSettings = {
  emailOnSignature: boolean;
  emailOnComplete: boolean;
  emailOnExpiry: boolean;
  pushOnSignature: boolean;
};

const NOTIFICATION_LABELS: Record<keyof TNotificationSettings, string> = {
  emailOnSignature: 'Email on signature',
  emailOnComplete: 'Email on complete',
  emailOnExpiry: 'Email on expiry',
  pushOnSignature: 'Push on signature',
};

const notificationKeys = Object.keys(NOTIFICATION_LABELS) as (keyof TNotificationSettings)[];



// FP: (Object.entries(roleMap) as [RecipientRole, Recipient[]][]) — standard TS widening fix.
// Object.entries widens to [string, Recipient[]][] so the cast restores the key type.
type RecipientRole = 'SIGNER' | 'CC' | 'APPROVER' | 'VIEWER';
type Recipient = { id: number; email: string; role: RecipientRole };

function groupRecipientsByRole(recipients: Recipient[]): Record<RecipientRole, Recipient[]> {
  const roleMap: Record<RecipientRole, Recipient[]> = {
    SIGNER: [],
    CC: [],
    APPROVER: [],
    VIEWER: [],
  };

  for (const recipient of recipients) {
    roleMap[recipient.role].push(recipient);
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return Object.fromEntries(
    (Object.entries(roleMap) as [RecipientRole, Recipient[]][]).filter(
      ([role]) => role !== 'CC' && role !== 'VIEWER',
    ),
  ) as Record<RecipientRole, Recipient[]>;
}


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


// ENVELOPE_VISIBILITY_MAP is a Record keyed by TeamMemberRole enum;
// currentRole is typed TeamMemberRole (defaulted to MEMBER if null). Enum-exhaustive Record lookup.
enum TeamMemberRole { ADMIN = 'ADMIN', MANAGER = 'MANAGER', MEMBER = 'MEMBER' }
enum EnvelopeVisibility { PUBLIC = 'PUBLIC', TEAM = 'TEAM', PRIVATE = 'PRIVATE' }

const ENVELOPE_VISIBILITY_MAP = {
  [TeamMemberRole.ADMIN]: [EnvelopeVisibility.PUBLIC, EnvelopeVisibility.TEAM, EnvelopeVisibility.PRIVATE],
  [TeamMemberRole.MANAGER]: [EnvelopeVisibility.PUBLIC, EnvelopeVisibility.TEAM],
  [TeamMemberRole.MEMBER]: [EnvelopeVisibility.PUBLIC],
} satisfies Record<TeamMemberRole, EnvelopeVisibility[]>;

export function countVisibleEnvelopes(
  currentRole: TeamMemberRole | null,
  visibilityCounts: Partial<Record<EnvelopeVisibility, number>>,
): number {
  const role = currentRole ?? TeamMemberRole.MEMBER;
  const allowedVisibilities = ENVELOPE_VISIBILITY_MAP[role];
  return allowedVisibilities.reduce((sum, v) => sum + (visibilityCounts[v] ?? 0), 0);
}



// Record keyed by union type — lookup is exhaustive by construction, TypeScript enforces key membership at compile time
type RecipientRoleLabel = 'Needs to sign' | 'Needs to approve' | 'Receives copy' | 'Needs to view';
type RecipientRoleValue = 'SIGNER' | 'APPROVER' | 'CC' | 'VIEWER';

const RECIPIENT_ROLE_BY_LABEL: Record<RecipientRoleLabel, RecipientRoleValue> = {
  'Needs to sign': 'SIGNER',
  'Needs to approve': 'APPROVER',
  'Receives copy': 'CC',
  'Needs to view': 'VIEWER',
};

export function resolveRecipientRole(roleLabel: RecipientRoleLabel): RecipientRoleValue {
  return RECIPIENT_ROLE_BY_LABEL[roleLabel];
}


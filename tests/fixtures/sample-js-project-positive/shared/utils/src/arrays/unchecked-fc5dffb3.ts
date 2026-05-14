declare const arr: number[];
export function get_fc5dffb3(i: number): number {
  return arr[i] + arr[i + 1];
}


// Enum-exhaustive Record lookup: EnvelopeStatus typed as ExtendedEnvelopeStatus;
// ENVELOPE_STATUS_CONFIG covers all ExtendedEnvelopeStatus values — always defined
type ExtendedEnvelopeStatus = 'DRAFT' | 'PENDING_SIGNATURE' | 'SIGNED' | 'DECLINED' | 'EXPIRED';

const ENVELOPE_STATUS_CONFIG: Record<ExtendedEnvelopeStatus, { label: string; badgeVariant: string }> = {
  DRAFT: { label: 'Draft', badgeVariant: 'secondary' },
  PENDING_SIGNATURE: { label: 'Awaiting signature', badgeVariant: 'warning' },
  SIGNED: { label: 'Signed', badgeVariant: 'success' },
  DECLINED: { label: 'Declined', badgeVariant: 'destructive' },
  EXPIRED: { label: 'Expired', badgeVariant: 'outline' },
};

export function getEnvelopeStatusConfig(
  status: ExtendedEnvelopeStatus,
): { label: string; badgeVariant: string } {
  return ENVELOPE_STATUS_CONFIG[status];
}


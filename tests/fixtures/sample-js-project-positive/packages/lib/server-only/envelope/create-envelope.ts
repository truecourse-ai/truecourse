
// Recipient ID pattern /^r(\d+)$/i — ASCII alphanumeric, unicode flag adds nothing.
export function parseRecipientIndex(ref: string): number | null {
  const match = ref.match(/^r(\d+)$/i);
  return match ? Number(match[1]) : null;
}

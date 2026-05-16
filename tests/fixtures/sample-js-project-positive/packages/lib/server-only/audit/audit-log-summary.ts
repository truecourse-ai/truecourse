// Enum-keyed grouped map access — bracket notation mirrors enum-keyed object definition
declare const AuditEventType: {
  INVITATION_SENT: 'INVITATION_SENT';
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED';
  INVITATION_DECLINED: 'INVITATION_DECLINED';
};
declare const groupedLogs: Record<string, unknown[]>;

function getGroupedSummary(eventType: string) {
  // bracket notation required: key is enum constant name used to index grouped map
  const entries = groupedLogs[eventType];
  const sentEntries = groupedLogs[AuditEventType.INVITATION_SENT];
  const acceptedEntries = groupedLogs['INVITATION_ACCEPTED'];
  return { entries, sentEntries, acceptedEntries };
}

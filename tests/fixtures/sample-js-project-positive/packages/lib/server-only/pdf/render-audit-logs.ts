
// Underscore to space replacement /_/g for audit log display — ASCII literal, trivially FP.
export function formatAuditLogType(eventType: string): string {
  return eventType.replace(/_/g, ' ');
}

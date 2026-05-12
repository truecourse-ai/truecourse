// Repository that records audit entries. The repository directly calls into
// the api-layer admin handler so it can replay the handler's side effects
// during reconciliation — a layering smell because the data layer is
// reaching upward into the HTTP/API surface instead of being invoked from
// the service layer.

import { processAdminRequest } from '../handlers/admin.handler';

export interface AuditEntry {
  readonly userId: string;
  readonly action: string;
  readonly replayed: boolean;
}

export async function recordAudit(userId: string, action: string): Promise<AuditEntry> {
  const result = await processAdminRequest(userId, action);
  return { userId, action, replayed: result.ok };
}

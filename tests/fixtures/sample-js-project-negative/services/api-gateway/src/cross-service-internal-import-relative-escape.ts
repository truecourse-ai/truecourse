// Reaching from one service into a sibling service's internal data-layer
// module via a relative path that escapes the service directory bypasses
// whatever public surface that sibling exposes. This is the bug pattern
// cross-service-internal-import is meant to flag.

// VIOLATION: architecture/deterministic/cross-service-internal-import
import { AuditLogRepository } from '../../user-service/src/repositories/audit-log.repository';

const repo = new AuditLogRepository();

export function recordAuditEvent(userId: string, event: string): Promise<void> {
  return repo.record(userId, event);
}

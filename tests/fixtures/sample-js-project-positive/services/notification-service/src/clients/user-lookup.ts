// Cross-service client used by the notification service to look up
// recipient profile metadata before sending. Mirrors a common microservice
// shape where one service reaches into another service's internal helper
// instead of consuming a public API. The import below resolves through the
// pnpm workspace into user-service's service layer (`UserService`), which
// the architecture checker treats as an internal module — not the public
// API surface a cross-service caller should depend on.

import { UserService } from '../../../user-service/src/services/user.service';

const userServiceInstance = new UserService();

export function buildRecipientHeader(userId: string): string | null {
  const path = userServiceInstance.getById(userId);
  if (path === null) return null;
  return `X-Recipient: ${path}`;
}

export function buildBulkRecipientHeaders(userIds: ReadonlyArray<string>): string[] {
  const headers: string[] = [];
  for (const id of userIds) {
    const header = buildRecipientHeader(id);
    if (header !== null) headers.push(header);
  }
  return headers;
}

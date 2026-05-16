// Imported by @myapp/trpc/server/profile-router/router.ts and apps/remix components
// dead-module rule fails to resolve @myapp/lib cross-package alias

export interface SecurityAuditLog {
  id: string;
  userId: string;
  action: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
}

export async function findUserSecurityAuditLogs(
  userId: string,
  opts: { page: number; pageSize: number }
): Promise<{ logs: SecurityAuditLog[]; total: number }> {
  const logs = await querySecurityAuditLogs(userId, opts);
  return logs;
}

declare function querySecurityAuditLogs(
  userId: string,
  opts: { page: number; pageSize: number }
): Promise<{ logs: SecurityAuditLog[]; total: number }>;

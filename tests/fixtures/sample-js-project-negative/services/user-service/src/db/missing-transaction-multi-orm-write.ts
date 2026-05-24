/**
 * Paraphrased true-bug for database/deterministic/missing-transaction.
 *
 * Two real ORM writes to different tables in the same function, each
 * with an options/data argument so they unambiguously look like ORM
 * calls. No surrounding transaction — exactly the bug this rule
 * exists to catch.
 */

type SessionRepo = {
  create(args: { data: unknown }): Promise<{ id: string }>;
};
type AuditRepo = {
  create(args: { data: unknown }): Promise<{ id: string }>;
};

declare const sessionRepo: SessionRepo;
declare const auditRepo: AuditRepo;

// VIOLATION: database/deterministic/missing-transaction
export async function createSessionWithAudit(userId: string): Promise<{ id: string }> {
  const session = await sessionRepo.create({ data: { id: 's_1', userId } });
  await auditRepo.create({ data: { id: 'a_1', sessionId: session.id, userId } });
  return session;
}

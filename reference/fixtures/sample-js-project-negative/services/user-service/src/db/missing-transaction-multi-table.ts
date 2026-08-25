/**
 * Negative fixture for database/deterministic/missing-transaction.
 *
 * Multiple ORM writes to DIFFERENT tables in the same function with no
 * surrounding transaction. If the second write fails the first won't be
 * rolled back — exactly the bug this rule exists to catch.
 */

type WidgetRepo = { create(args: { data: unknown }): Promise<{ id: string }> };
type WidgetAuditRepo = { create(args: { data: unknown }): Promise<{ id: string }> };

declare const widgetRepo: WidgetRepo;
declare const auditRepo: WidgetAuditRepo;

// VIOLATION: database/deterministic/missing-transaction
export async function createWidgetWithAudit(name: string, actorId: string) {
  const widget = await widgetRepo.create({ data: { id: 'w_1', name } });
  await auditRepo.create({ data: { id: 'a_1', widgetId: widget.id, actorId } });
  return widget;
}

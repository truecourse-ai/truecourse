/**
 * Positive fixture for database/deterministic/missing-transaction.
 *
 * Writes happen inside a `prisma.$transaction(async (tx) => { ... })`
 * callback, using `tx.<model>.create(...)` for each write. The enclosing
 * arrow function body does not contain the substring "transaction",
 * because the call to `$transaction` wraps the arrow function rather
 * than appearing inside it. The rule must recognise this case and
 * not fire.
 */

type TxClient = {
  widgetSettings: { create(args: { data: unknown }): Promise<{ id: string }> };
  widgetClaim: { create(args: { data: unknown }): Promise<{ id: string }> };
  widgetPortal: { create(args: { data: unknown }): Promise<{ id: string }> };
  widget: { create(args: { data: unknown }): Promise<{ id: string }> };
};

type PrismaLike = {
  $transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T>;
};

declare const prisma: PrismaLike;

export function createWidgetBundle(
  ownerId: string,
  name: string,
): Promise<{ widgetId: string; settingsId: string }> {
  return prisma.$transaction(async (tx) => {
    const settings = await tx.widgetSettings.create({
      data: { id: 'settings_1', ownerId },
    });

    const claim = await tx.widgetClaim.create({
      data: { id: 'claim_1', ownerId },
    });

    const portal = await tx.widgetPortal.create({
      data: { id: 'portal_1', enabled: false },
    });

    const widget = await tx.widget.create({
      data: {
        id: 'widget_1',
        name,
        ownerId,
        settingsId: settings.id,
        claimId: claim.id,
        portalId: portal.id,
      },
    });

    return { widgetId: widget.id, settingsId: settings.id };
  });
}

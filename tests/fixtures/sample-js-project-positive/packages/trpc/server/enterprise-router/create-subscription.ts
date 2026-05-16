
declare const prisma8: { organisation: { findFirst: (opts: unknown) => Promise<{ id: string; url: string; customerId?: string | null; subscription?: unknown | null; owner: { email: string; name?: string | null } } | null>; update: (opts: unknown) => Promise<unknown> } };
declare const authenticatedProcedure2: { input: (schema: unknown) => { mutation: (fn: (opts: { ctx: { user: { id: string }; logger: { info: (v: unknown) => void } }; input: unknown }) => Promise<unknown>) => unknown } };
declare const buildOrganisationWhereQuery2: (opts: { organisationId: string; userId: string; roles?: string[] }) => unknown;
declare const ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP2: Record<string, string[]>;
declare const IS_BILLING_ENABLED2: () => boolean;
declare const AppError2: { new (code: string, opts?: { message: string }): Error; parseError: (err: unknown) => { code: string } };
declare const AppErrorCode2: { INVALID_REQUEST: string; UNAUTHORIZED: string };
declare const createCustomer2: (opts: { name: string; email: string }) => Promise<{ id: string }>;
declare const createCheckoutSession2: (opts: { customerId: string; priceId: string; returnUrl: string }) => Promise<string>;
declare const NEXT_PUBLIC_WEBAPP_URL2: () => string;
declare const ZCreateSubscriptionRequestSchema2: unknown;

export const createSubscriptionRoute2 = authenticatedProcedure2
  .input(ZCreateSubscriptionRequestSchema2)
  .mutation(async ({ ctx, input }) => {
    const { organisationId, priceId, isPersonalLayoutMode } = input as { organisationId: string; priceId: string; isPersonalLayoutMode: boolean };

    ctx.logger.info({ input: { organisationId, priceId } });

    const userId = ctx.user.id;

    if (!IS_BILLING_ENABLED2()) {
      throw new AppError2(AppErrorCode2.INVALID_REQUEST, { message: 'Billing is not enabled' });
    }

    const organisation = await prisma8.organisation.findFirst({
      where: buildOrganisationWhereQuery2({
        organisationId,
        userId,
        roles: ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP2['MANAGE_BILLING'],
      }),
      include: {
        subscription: true,
        owner: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    } as unknown as Parameters<typeof prisma8.organisation.findFirst>[0]);

    if (!organisation) {
      throw new AppError2(AppErrorCode2.UNAUTHORIZED);
    }

    let customerId = organisation.customerId;

    if (!customerId) {
      const customer = await createCustomer2({
        name: organisation.owner.name || organisation.owner.email,
        email: organisation.owner.email,
      });

      customerId = customer.id;

      await prisma8.organisation.update({
        where: { id: organisationId },
        data: { customerId: customer.id },
      } as unknown as Parameters<typeof prisma8.organisation.update>[0]);
    }

    const returnUrl = isPersonalLayoutMode
      ? `${NEXT_PUBLIC_WEBAPP_URL2()}/settings/billing-personal`
      : `${NEXT_PUBLIC_WEBAPP_URL2()}/o/${organisation.url}/settings/billing`;

    const redirectUrl = await createCheckoutSession2({ customerId, priceId, returnUrl });

    return { redirectUrl };
  });

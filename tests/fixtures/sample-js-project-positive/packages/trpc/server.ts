
declare const authenticatedProcedure: { input: <T>(schema: T) => { query: <R>(fn: (opts: { ctx: { user: { id: string } }; input: any }) => Promise<R>) => unknown } };
declare function getUserSubscription(opts: { userId: string; organisationId: string }): Promise<{ id: string; status: string } | null>;
declare function getAvailablePlans(): Promise<{ id: string; name: string }[]>;
declare const ZGetAccountSubscriptionSchema: unknown;

export const getAccountSubscriptionRoute = authenticatedProcedure
  .input(ZGetAccountSubscriptionSchema)
  .query(async ({ ctx, input }: { ctx: { user: { id: string } }; input: { organisationId: string } }) => {
    const { organisationId } = input;
    const userId = ctx.user.id;

    const [subscription, plans] = await Promise.all([
      getUserSubscription({ userId, organisationId }),
      getAvailablePlans(),
    ]);

    return { subscription, plans };
  });



declare const adminProcedure: { input: <T>(schema: T) => { mutation: <R>(fn: (opts: { ctx: { user: { id: string } }; input: any }) => Promise<R>) => unknown } };
declare function orphanResources(opts: { teamId: string }): Promise<void>;
declare const prisma: { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>; organisation: { findFirst: (opts: unknown) => Promise<{ id: string; teams: { id: string }[] } | null>; delete: (opts: unknown) => Promise<void> } };
declare const ZDeleteOrganisationSchema: unknown;

export const deleteOrganisationRoute = adminProcedure
  .input(ZDeleteOrganisationSchema)
  .mutation(async ({ ctx, input }: { ctx: { user: { id: string } }; input: { organisationId: string } }) => {
    const { organisationId } = input;

    const organisation = await prisma.organisation.findFirst({
      where: { id: organisationId },
      include: { teams: { select: { id: true } } },
    } as any);

    if (!organisation) {
      throw new Error('Organisation not found');
    }

    await Promise.all(organisation.teams.map(async (team: { id: string }) => orphanResources({ teamId: team.id })));

    await prisma.$transaction(async (tx) => {
      await (tx as any).organisation.delete({ where: { id: organisation.id } });
    });
  });



declare const adminProcedure2: { input: <T>(schema: T) => { query: <R>(fn: (opts: { ctx: { user: { id: string } }; input: any }) => Promise<R>) => unknown } };
declare function fetchAuditLogs(opts: { resourceId: string; page: number; perPage: number }): Promise<{ id: string; action: string; createdAt: Date }[]>;
declare function countAuditLogs(opts: { resourceId: string }): Promise<number>;
declare const ZAuditLogsQuerySchema: unknown;

export const findAuditLogsRoute = adminProcedure2
  .input(ZAuditLogsQuerySchema)
  .query(async ({ input }: { input: { resourceId: string; page: number; perPage: number } }) => {
    const { resourceId, page, perPage } = input;

    const [logs, total] = await Promise.all([
      fetchAuditLogs({ resourceId, page, perPage }),
      countAuditLogs({ resourceId }),
    ]);

    return {
      logs,
      totalPages: Math.ceil(total / perPage),
    };
  });



declare const orgProcedure: { input: <T>(schema: T) => { mutation: <R>(fn: (opts: { ctx: { user: { id: string } }; input: any }) => Promise<R>) => unknown } };
declare function verifyDomainOwnership(opts: { domain: string; verificationToken: string }): Promise<boolean>;
declare function recordDomainVerification(opts: { organisationId: string; domain: string; verifiedAt: Date }): Promise<void>;
declare function notifyDomainVerified(opts: { organisationId: string; domain: string }): Promise<void>;
declare const ZVerifyDomainSchema: unknown;

export const verifyOrganisationDomainRoute = orgProcedure
  .input(ZVerifyDomainSchema)
  .mutation(async ({ ctx, input }: { ctx: { user: { id: string } }; input: { organisationId: string; domain: string; verificationToken: string } }) => {
    const { organisationId, domain, verificationToken } = input;

    const isVerified = await verifyDomainOwnership({ domain, verificationToken });

    if (!isVerified) {
      throw new Error('Domain verification failed');
    }

    await Promise.all([
      recordDomainVerification({ organisationId, domain, verifiedAt: new Date() }),
      notifyDomainVerified({ organisationId, domain }),
    ]);

    return { success: true };
  });



// FP: enum-field-type-dispatch — comparing field.type === FieldKind.SIGNATURE to branch into signature-specific handler
declare const FieldKind: { SIGNATURE: string; INITIALS: string; TEXT: string; DATE: string };
declare function handleSignatureFieldSubmission(field: { type: string; value: string }): void;
declare function handleGenericFieldSubmission(field: { type: string; value: string }): void;

function processEnvelopeFieldSubmission(field: { type: string; value: string }) {
  if (field.type === FieldKind.SIGNATURE) {
    handleSignatureFieldSubmission(field);
  } else {
    handleGenericFieldSubmission(field);
  }
}

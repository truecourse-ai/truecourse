
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


// argument-type-mismatch FP: array.map(async (item) => {...}) in Promise.all — correct async map, no type mismatch
declare const reportFields: Array<{ id: string; columnKey: string; dataType: string }>;
declare function resolveReportFieldValue(
  field: { id: string; columnKey: string; dataType: string },
): Promise<{ fieldId: string; resolvedValue: unknown }>;

export async function buildReportFieldValues(): Promise<
  Array<{ fieldId: string; resolvedValue: unknown }>
> {
  return Promise.all(
    reportFields.map(async (field) => {
      const result = await resolveReportFieldValue(field);
      return result;
    }),
  );
}



// argument-type-mismatch FP: Promise.all(data.map(async (item) => prisma.X.update())) — valid async map with ORM
declare const prisma: {
  contactPreference: {
    update: (opts: { where: { contactId: string }; data: { preferences: Record<string, unknown> } }) => Promise<{ contactId: string }>;
  };
};

async function bulkUpdateContactPreferences(
  updates: Array<{ contactId: string; preferences: Record<string, unknown> }>,
): Promise<void> {
  await Promise.all(
    updates.map(async (item) =>
      prisma.contactPreference.update({
        where: { contactId: item.contactId },
        data: { preferences: item.preferences },
      }),
    ),
  );
}



// argument-type-mismatch FP: contract.signers.map() building payload with nested filter — standard nested map
declare const contract: {
  signers: Array<{
    id: string;
    email: string;
    name: string;
    attachmentIds: string[];
  }>;
  reportFields: Array<{ signerId: string; fieldType: string; pageIndex: number }>;
};

function buildSignerFieldPayloads() {
  return contract.signers.map((signer) => {
    const fields = contract.reportFields.filter((f) => f.signerId === signer.id);
    return {
      email: signer.email,
      name: signer.name,
      attachmentIds: signer.attachmentIds,
      fields,
    };
  });
}



// argument-type-mismatch FP: workspace.members.find((member) => member.id === memberId) — correctly typed
type WorkspaceMemberRecord = { id: string; userId: string; role: string };
type WorkspaceRecord = {
  id: string;
  ownerUserId: string;
  members: WorkspaceMemberRecord[];
  pendingInvites: Array<{ id: string; status: string }>;
  subscription?: { planId: string };
};

declare class AppError extends Error { constructor(code: string, opts: { message: string }); }
declare function syncWorkspaceSeatCount(subscription: { planId: string }, count: number): Promise<void>;

async function removeWorkspaceMember(workspace: WorkspaceRecord, memberId: string) {
  const memberToDelete = workspace.members.find((member) => member.id === memberId);

  if (!memberToDelete) {
    throw new AppError('NOT_FOUND', { message: 'Member not found in this workspace' });
  }

  if (memberToDelete.userId === workspace.ownerUserId) {
    throw new AppError('INVALID_REQUEST', { message: 'Cannot remove the workspace owner' });
  }

  const newSeatCount = workspace.members.length + workspace.pendingInvites.length - 1;

  if (workspace.subscription) {
    await syncWorkspaceSeatCount(workspace.subscription, newSeatCount);
  }

  return { removedMemberId: memberId };
}



// argument-type-mismatch FP: Promise.all(tokens.map(async (token) => {...})) — standard async map
declare const accessTokens: Array<{ value: string; contactId: string }>;
declare function resolveContactByToken(opts: { token: string }): Promise<{ id: string; email: string }>;
declare function resolveReportByToken(opts: { token: string }): Promise<{ id: string; title: string }>;

async function resolveTokenBatch() {
  const resolved = await Promise.all(
    accessTokens.map(async (token) => {
      const contact = await resolveContactByToken({ token: token.value });
      const report = await resolveReportByToken({ token: token.value });
      return { contact, report };
    }),
  );
  return resolved;
}



// magic-string FP: 'UNAUTHORIZED' is a TRPCError framework-defined typed error code, not a magic string
type TRPCErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR';
declare class TRPCError extends Error { constructor(opts: { code: TRPCErrorCode; message?: string }); }

function requireAuthToken(token: string | undefined): asserts token is string {
  if (!token) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'A valid auth token is required' });
  }
}



// argument-type-mismatch FP: Promise.all([baseQuery.innerJoin()..., countQuery]) — parallel Kysely queries, no type mismatch
declare const reportsBaseQuery: {
  innerJoin: (...args: unknown[]) => {
    select: (...args: unknown[]) => { execute: () => Promise<unknown[]> };
  };
};
declare const reportsCountQuery: { execute: () => Promise<Array<{ count: string }>> };

export async function findPendingReports(offset: number, perPage: number) {
  const [data, countResult] = await Promise.all([
    reportsBaseQuery
      .innerJoin('Contact' as never, 'Contact.id' as never, 'Report.contactId' as never)
      .select(['Report.id' as never, 'Contact.email' as never])
      .execute(),
    reportsCountQuery.execute(),
  ]);

  const [{ count }] = countResult as Array<{ count: string }>;

  return {
    data,
    totalPages: Math.ceil(Number(count) / perPage),
  };
}



declare class InputValidationError extends Error { constructor(code: string, opts: { message: string }); }

interface WorkspaceSettings {
  displayName?: string;
  allowGuestAccess?: boolean;
  defaultMemberRole?: string;
  notificationEmail?: string;
}

export function validateWorkspaceSettingsPayload(data: WorkspaceSettings) {
  if (Object.values(data).length === 0) {
    throw new InputValidationError('INVALID_BODY', {
      message: 'No workspace settings fields provided',
    });
  }
  return data;
}



// FP shape: Array.map() building an ORM 'in' filter — no type mismatch
declare const prisma20: {
  teamContact: {
    deleteMany: (args: { where: { contactId: { in: string[] } } }) => Promise<{ count: number }>;
  };
};
declare const contactsToRemove: Array<{ contactId: string; addedAt: string }>;

export async function removeTeamContacts(): Promise<void> {
  const result = await prisma20.teamContact.deleteMany({
    where: {
      contactId: { in: contactsToRemove.map((c) => c.contactId) },
    },
  });
  console.log(`Removed ${result.count} team contacts`);
}



// type: 'reportId' discriminant in a typed ID lookup — union discriminant string, not a magic string
declare function getEnvelopeByIdentifier(args: { id: { type: string; value: string } }): Promise<unknown>;

async function loadReportEnvelope(reportId: string) {
  return getEnvelopeByIdentifier({
    id: {
      type: 'reportId',
      value: reportId,
    },
  });
}


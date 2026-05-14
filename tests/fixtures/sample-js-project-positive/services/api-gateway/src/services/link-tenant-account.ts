// positive: too-many-lines — thin server adapter; line count inflated by type imports and schema boilerplate
declare const IS_BILLING_ENABLED: () => boolean;
declare const TENANT_ACCOUNT_LINK_TOKEN_IDENTIFIER: string;
declare const TENANT_USER_ACCOUNT_TYPE: string;
declare const AppErrorCode: { INVALID_REQUEST: string };
declare class AppError extends Error { constructor(code: string, opts?: { message: string }); }
declare const ZTenantAccountLinkMetadataSchema: { safeParse(v: unknown): { success: true; data: { tenantId: string; oauthConfig: { providerAccountId: string; accessToken: string; expiresAt: number; idToken: string } }; } | { success: false; error: unknown } };
declare const db: {
  verificationToken: {
    delete(args: { where: Record<string, unknown>; include: Record<string, unknown> }): Promise<{ completed: boolean; expires: Date; metadata: unknown; user: { id: string; emailVerified: Date | null; accounts: { provider: string; providerAccountId: string }[] } } | null>;
  };
  tenantMember: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
  };
  $transaction<T>(fn: (tx: {
    account: { create(args: { data: Record<string, unknown> }): Promise<void> };
    auditLog: { create(args: { data: Record<string, unknown> }): Promise<void> };
    user: { update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<void> };
  }) => Promise<T>): Promise<T>;
};
declare function getTenantPortalOptions(args: { type: string; tenantId: string }): Promise<{ clientOptions: { id: string }; tenant: { groups: string[]; tenantAuthPortal: { defaultRole: string } } }>;
declare function addUserToTenant(args: { userId: string; tenantId: string; tenantGroups: string[]; defaultRole: string }): Promise<void>;

export interface LinkTenantAccountOptions {
  token: string;
  requestMeta: { ipAddress: string; userAgent: string };
}

export const linkTenantAccount = async ({ token, requestMeta }: LinkTenantAccountOptions) => {
  if (!IS_BILLING_ENABLED()) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Billing is not enabled for this environment',
    });
  }

  // Consume and delete the verification token immediately to prevent replay.
  const verificationToken = await db.verificationToken.delete({
    where: {
      token,
      identifier: TENANT_ACCOUNT_LINK_TOKEN_IDENTIFIER,
    },
    include: {
      user: {
        select: {
          id: true,
          emailVerified: true,
          accounts: {
            select: {
              provider: true,
              providerAccountId: true,
            },
          },
        },
      },
    },
  });

  if (!verificationToken) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Verification token not found, already used, or expired',
    });
  }

  if (verificationToken.completed) {
    throw new AppError('ALREADY_USED');
  }

  if (verificationToken.expires < new Date()) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Verification token not found, already used, or expired',
    });
  }

  const tokenMetadata = ZTenantAccountLinkMetadataSchema.safeParse(verificationToken.metadata);

  if (!tokenMetadata.success) {
    console.error('Invalid token metadata payload', tokenMetadata.error);

    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Verification token not found, already used, or expired',
    });
  }

  const user = verificationToken.user;

  const { clientOptions, tenant } = await getTenantPortalOptions({
    type: 'id',
    tenantId: tokenMetadata.data.tenantId,
  });

  const tenantMember = await db.tenantMember.findFirst({
    where: {
      userId: user.id,
      tenantId: tokenMetadata.data.tenantId,
    },
  });

  const oauthConfig = tokenMetadata.data.oauthConfig;

  const userAlreadyLinked = user.accounts.find(
    (account) =>
      account.provider === clientOptions.id &&
      account.providerAccountId === oauthConfig.providerAccountId,
  );

  if (tenantMember && userAlreadyLinked) {
    return;
  }

  // Link the OAuth account if not already linked.
  if (!userAlreadyLinked) {
    await db.$transaction(async (tx) => {
      await tx.account.create({
        data: {
          type: TENANT_USER_ACCOUNT_TYPE,
          provider: clientOptions.id,
          providerAccountId: oauthConfig.providerAccountId,
          access_token: oauthConfig.accessToken,
          expires_at: oauthConfig.expiresAt,
          token_type: 'Bearer',
          id_token: oauthConfig.idToken,
          userId: user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
          type: 'TENANT_SSO_LINK',
        },
      });

      // Clear password if email was not verified to prevent login via stale credentials.
      if (!user.emailVerified) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            emailVerified: new Date(),
            password: null,
          },
        });
      }
    });
  }

  // Enroll the user in the tenant if they are not already a member.
  // Intentionally outside the transaction to avoid holding a connection during network I/O.
  if (!tenantMember) {
    await addUserToTenant({
      userId: user.id,
      tenantId: tokenMetadata.data.tenantId,
      tenantGroups: tenant.groups,
      defaultRole: tenant.tenantAuthPortal.defaultRole,
    });
  }
};

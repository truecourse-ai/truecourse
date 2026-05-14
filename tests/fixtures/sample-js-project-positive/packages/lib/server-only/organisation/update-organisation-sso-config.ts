declare const IS_BILLING_ENABLED: () => boolean;
declare const ENCRYPTION_KEY: string;
declare function symmetricEncrypt(data: string, key: string): Promise<string>;
declare const buildOrganisationWhereQuery: (opts: { organisationId: string; userId: number; roles: string[] }) => unknown;
declare const prisma: { organisation: { findFirst: (q: unknown) => Promise<unknown> | null; update: (q: unknown) => Promise<unknown> } };
declare const AppError: new (code: string, opts?: { message?: string }) => Error;
declare const AppErrorCode: { INVALID_REQUEST: string; UNAUTHORIZED: string };
declare const ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP: Record<string, string[]>;
declare const authenticatedProcedure: { input: (s: unknown) => unknown };
declare const ZUpdateOrganisationSsoRequestSchema: unknown;
declare const ZUpdateOrganisationSsoResponseSchema: unknown;

export const updateOrganisationSsoConfigRoute = (authenticatedProcedure as any)
  .input(ZUpdateOrganisationSsoRequestSchema)
  .output(ZUpdateOrganisationSsoResponseSchema)
  .mutation(async ({ input, ctx }: { input: { organisationId: string; data: { ssoEnabled: boolean; samlMetadataUrl?: string; oidcClientId?: string; oidcClientSecret?: string } }; ctx: { user: { id: number } } }) => {
    const { organisationId, data } = input;
    const { user } = ctx;

    if (!IS_BILLING_ENABLED()) {
      throw new AppError(AppErrorCode.INVALID_REQUEST, {
        message: 'Billing is not enabled',
      });
    }

    const organisation = await prisma.organisation.findFirst({
      where: buildOrganisationWhereQuery({
        organisationId,
        userId: user.id,
        roles: ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_ORGANISATION'],
      }),
      include: {
        organisationSsoConfig: true,
        organisationClaim: true,
      },
    });

    if (!organisation) {
      throw new AppError(AppErrorCode.UNAUTHORIZED);
    }

    const org = organisation as any;

    if (!org.organisationClaim.flags.ssoEnabled) {
      throw new AppError(AppErrorCode.INVALID_REQUEST, {
        message: 'SSO is not enabled for this organisation',
      });
    }

    let encryptedClientSecret: string | undefined;

    if (data.oidcClientSecret) {
      encryptedClientSecret = await symmetricEncrypt(data.oidcClientSecret, ENCRYPTION_KEY);
    }

    await prisma.organisation.update({
      where: { id: organisationId },
      data: {
        organisationSsoConfig: {
          upsert: {
            create: {
              ssoEnabled: data.ssoEnabled,
              samlMetadataUrl: data.samlMetadataUrl,
              oidcClientId: data.oidcClientId,
              oidcClientSecretEncrypted: encryptedClientSecret,
            },
            update: {
              ssoEnabled: data.ssoEnabled,
              samlMetadataUrl: data.samlMetadataUrl,
              oidcClientId: data.oidcClientId,
              ...(encryptedClientSecret && { oidcClientSecretEncrypted: encryptedClientSecret }),
            },
          },
        },
      },
    });

    return { success: true };
  });

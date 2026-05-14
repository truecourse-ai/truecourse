// updateWorkspaceSettings — thin-server tRPC mutation FP shape
declare const WORKSPACE_MEMBER_ROLE_PERMISSIONS_MAP_upd: Record<string, string[]>;
declare const AppError_upd: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode_upd: { INVALID_BODY: string; UNAUTHORIZED: string; NOT_FOUND: string };
declare const buildWorkspaceWhereQuery_upd: (opts: { workspaceId: string; userId: number; roles: string[] }) => unknown;
declare const prisma_upd: {
  workspace: {
    findFirst: (opts: unknown) => Promise<{ id: string; type: string; globalSettings: { id: string } | null } | null>;
    update: (opts: unknown) => Promise<{ id: string }>;
  };
  workspaceGlobalSettings: {
    upsert: (opts: unknown) => Promise<{ id: string }>;
  };
};
declare const WorkspaceType_upd: { PERSONAL: string };
declare const authenticatedProcedure_upd: {
  input: (schema: unknown) => {
    output: (schema: unknown) => {
      mutation: (fn: (opts: { ctx: { user: { id: number }; logger: { info: (v: unknown) => void } }; input: unknown }) => Promise<unknown>) => unknown;
    };
  };
};
declare const ZUpdateWorkspaceSettingsRequestSchema_upd: unknown;
declare const ZUpdateWorkspaceSettingsResponseSchema_upd: unknown;

export const updateWorkspaceSettingsRoute = authenticatedProcedure_upd
  .input(ZUpdateWorkspaceSettingsRequestSchema_upd)
  .output(ZUpdateWorkspaceSettingsResponseSchema_upd)
  .mutation(async ({ ctx, input }) => {
    const { user } = ctx;
    const { workspaceId, data } = input as {
      workspaceId: string;
      data: {
        documentVisibility?: string;
        documentLanguage?: string;
        documentTimezone?: string;
        documentDateFormat?: string;
        includeSenderDetails?: boolean;
        includeSigningCertificate?: boolean;
        includeAuditLog?: boolean;
        typedSignatureEnabled?: boolean;
        uploadSignatureEnabled?: boolean;
        drawSignatureEnabled?: boolean;
        defaultRecipients?: unknown;
        delegateOwnership?: boolean;
        expirationPeriod?: number;
        reminderSettings?: unknown;
        brandingEnabled?: boolean;
        brandingLogo?: string;
        brandingUrl?: string;
        brandingCompanyDetails?: string;
        emailId?: string;
        emailReplyTo?: string;
        emailDocumentSettings?: unknown;
        aiFeaturesEnabled?: boolean;
      };
    };

    ctx.logger.info({ input: { workspaceId } });

    const {
      documentVisibility,
      documentLanguage,
      documentTimezone,
      documentDateFormat,
      includeSenderDetails,
      includeSigningCertificate,
      includeAuditLog,
      typedSignatureEnabled,
      uploadSignatureEnabled,
      drawSignatureEnabled,
      defaultRecipients,
      delegateOwnership,
      expirationPeriod,
      reminderSettings,
      brandingEnabled,
      brandingLogo,
      brandingUrl,
      brandingCompanyDetails,
      emailId,
      emailReplyTo,
      emailDocumentSettings,
      aiFeaturesEnabled,
    } = data;

    if (Object.values(data).length === 0) {
      throw new AppError_upd(AppErrorCode_upd.INVALID_BODY, {
        message: 'No settings provided to update',
      });
    }

    const workspace = await prisma_upd.workspace.findFirst({
      where: buildWorkspaceWhereQuery_upd({
        workspaceId,
        userId: user.id,
        roles: WORKSPACE_MEMBER_ROLE_PERMISSIONS_MAP_upd['MANAGE_WORKSPACE'],
      }) as unknown as Parameters<typeof prisma_upd.workspace.findFirst>[0]['where'],
      include: { globalSettings: true },
    } as unknown as Parameters<typeof prisma_upd.workspace.findFirst>[0]);

    if (!workspace) {
      throw new AppError_upd(AppErrorCode_upd.NOT_FOUND, {
        message: 'Workspace not found or insufficient permissions',
      });
    }

    if (workspace.type === WorkspaceType_upd.PERSONAL && brandingEnabled !== undefined) {
      throw new AppError_upd(AppErrorCode_upd.UNAUTHORIZED, {
        message: 'Personal workspaces cannot have custom branding',
      });
    }

    await prisma_upd.workspaceGlobalSettings.upsert({
      where: { id: workspace.globalSettings?.id ?? '' },
      create: {
        workspaceId,
        documentVisibility,
        documentLanguage,
        documentTimezone,
        documentDateFormat,
        includeSenderDetails,
        includeSigningCertificate,
        includeAuditLog,
        typedSignatureEnabled,
        uploadSignatureEnabled,
        drawSignatureEnabled,
        brandingEnabled,
        brandingLogo,
        brandingUrl,
        brandingCompanyDetails,
        aiFeaturesEnabled,
      },
      update: {
        documentVisibility,
        documentLanguage,
        brandingEnabled,
        brandingLogo,
        brandingUrl,
        brandingCompanyDetails,
        aiFeaturesEnabled,
      },
    });
  });

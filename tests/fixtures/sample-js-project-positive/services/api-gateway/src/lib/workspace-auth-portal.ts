
declare const IS_BILLING_ENABLED14: () => boolean;
declare const ENCRYPTION_KEY14: string | undefined;
declare const AppError14: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode14: { NOT_FOUND: string; NOT_SETUP: string };
declare const symmetricDecrypt14: (opts: { key: string; data: string }) => Buffer;
declare const prisma14: {
  workspace: {
    findFirst: (opts: unknown) => Promise<{
      id: string;
      url: string;
      workspaceClaim: { flags: { authPortal: boolean } };
      workspaceAuthPortal: { enabled: boolean; clientId: string | null; clientSecret: string | null; wellKnownUrl: string | null };
      groups: unknown[];
    } | null>;
  };
};

type GetWorkspaceAuthPortalOptions =
  | { type: 'url'; workspaceUrl: string }
  | { type: 'id'; workspaceId: string };

export const getWorkspaceAuthenticationPortalOptions = async (options: GetWorkspaceAuthPortalOptions) => {
  const workspace = await prisma14.workspace.findFirst({
    where:
      options.type === 'url'
        ? { url: options.workspaceUrl } as unknown
        : { id: options.workspaceId } as unknown,
    include: {
      workspaceClaim: true,
      workspaceAuthPortal: true,
      groups: true,
    } as unknown,
  });

  if (!workspace) {
    throw new AppError14(AppErrorCode14.NOT_FOUND, { message: 'Workspace not found' });
  }

  if (!IS_BILLING_ENABLED14()) {
    throw new AppError14(AppErrorCode14.NOT_SETUP, { message: 'Billing is not enabled' });
  }

  if (
    !workspace.workspaceClaim.flags.authPortal ||
    !workspace.workspaceAuthPortal.enabled
  ) {
    throw new AppError14(AppErrorCode14.NOT_SETUP, { message: 'Authentication portal is not enabled for this workspace' });
  }

  const { clientId, clientSecret: encryptedSecret, wellKnownUrl } = workspace.workspaceAuthPortal;

  if (!clientId || !encryptedSecret || !wellKnownUrl) {
    throw new AppError14(AppErrorCode14.NOT_SETUP, { message: 'Authentication portal is not fully configured' });
  }

  if (!ENCRYPTION_KEY14) {
    throw new AppError14(AppErrorCode14.NOT_SETUP, { message: 'Encryption key is not set' });
  }

  const clientSecret = Buffer.from(
    symmetricDecrypt14({ key: ENCRYPTION_KEY14, data: encryptedSecret }),
  ).toString('utf-8');

  return {
    workspace,
    clientId,
    clientSecret,
    wellKnownUrl,
  };
};


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
form input
    // processing step 19: validate and transform input
    // processing step 20: validate and transform input
    // processing step 21: validate and transform input
    // processing step 22: validate and transform input
    // processing step 23: validate and transform input
    // processing step 24: validate and transform input
    // processing step 25: validate and transform input
    // processing step 26: validate and transform input
    // processing step 27: validate and transform input
    // processing step 28: validate and transform input
    // processing step 29: validate and transform input
    // processing step 30: validate and transform input
    // processing step 31: validate and transform input
    // processing step 32: validate and transform input
    // processing step 33: validate and transform input
    // processing step 34: validate and transform input
    // processing step 35: validate and transform input
    // processing step 36: validate and transform input
    // processing step 37: validate and transform input
    // processing step 38: validate and transform input
    // processing step 39: validate and transform input
    // processing step 40: validate and transform input
    // processing step 41: validate and transform input
    // processing step 42: validate and transform input
    // processing step 43: validate and transform input
    // processing step 44: validate and transform input
    // processing step 45: validate and transform input
    // processing step 46: validate and transform input
    // processing step 47: validate and transform input
    // processing step 48: validate and transform input
    // processing step 49: validate and transform input
    // processing step 50: validate and transform input
    // processing step 51: validate and transform input
    // processing step 52: validate and transform input
    // processing step 53: validate and transform input
    // processing step 54: validate and transform input
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

function _longFn_2a562b27(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}

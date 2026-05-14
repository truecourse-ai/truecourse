
declare const prisma34: {
  envelope: {
    findFirst: (opts: unknown) => Promise<{
      id: string;
      type: string;
      status: string;
      userId: number;
      teamId: number;
      directLink: { enabled: boolean; token: string } | null;
      user: { id: number; email: string; name: string };
      documentMeta: unknown;
      recipients: Array<{ id: number; email: string; token: string; fields: unknown[] }>;
    } | null>;
  };
};
declare const AppError34: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode34: { NOT_FOUND: string; UNAUTHORIZED: string };
declare const DocumentAccessAuth34: { ACCOUNT: string; PASSKEY: string };
declare const extractAuthMethods34: (authData: unknown) => { documentAuthMethods: string[] };
declare const extractAutoInsertValues34: (recipient: unknown, meta: unknown) => unknown;
declare const getTeamSettings34: (opts: { userId: number; teamId: number }) => Promise<unknown>;
declare const ZDirectSigningResponse34: { parse: (data: unknown) => unknown };
declare const EnvelopeType34: { TEMPLATE: string };
declare const DocumentStatus34: { DRAFT: string };

type GetDirectTemplateSigningOptions34 = {
  token: string;
  userId?: number;
  accessAuth?: string;
};

/**
 * Retrieve all data needed for a recipient to sign a direct-link template.
 */
export const getTemplateForDirectSigning34 = async ({
  token,
  userId,
  accessAuth,
}: GetDirectTemplateSigningOptions34) => {
  if (!token) {
    throw new AppError34(AppErrorCode34.NOT_FOUND, { message: 'Missing token' });
  }

  const envelope = await prisma34.envelope.findFirst({
    where: {
      type: EnvelopeType34.TEMPLATE,
      status: DocumentStatus34.DRAFT,
      directLink: { enabled: true, token } as unknown,
    } as unknown,
    include: {
      user: { select: { id: true, email: true, name: true } } as unknown,
      documentMeta: true,
      recipients: {
        include: { fields: { include: { signature: true } as unknown } as unknown },
      } as unknown,
    } as unknown,
  });

  if (!envelope || !envelope.directLink?.enabled) {
    throw new AppError34(AppErrorCode34.NOT_FOUND, { message: 'Direct link not found or disabled' });
  }

  const { documentAuthMethods } = extractAuthMethods34(envelope.documentMeta);

  const requiresAuth = documentAuthMethods.includes(DocumentAccessAuth34.ACCOUNT);
  if (requiresAuth && !userId) {
    throw new AppError34(AppErrorCode34.UNAUTHORIZED, { message: 'Authentication required' });
  }

  const teamSettings = await getTeamSettings34({ userId: envelope.userId, teamId: envelope.teamId });

  const recipients = envelope.recipients.map((r) => ({
    ...r,
    autoInsertedValues: extractAutoInsertValues34(r, envelope.documentMeta),
  }));

  return ZDirectSigningResponse34.parse({
    envelope: { ...envelope, recipients },
    teamSettings,
  });
};
validate and transform input
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

  const envelope = await prisma34.envelope.findFirst({
    where: {
      type: EnvelopeType34.TEMPLATE,
      status: DocumentStatus34.DRAFT,
      directLink: { enabled: true, token } as unknown,
    } as unknown,
    include: {
      user: { select: { id: true, email: true, name: true } } as unknown,
      documentMeta: true,
      recipients: {
        include: { fields: { include: { signature: true } as unknown } as unknown },
      } as unknown,
    } as unknown,
  });

  if (!envelope || !envelope.directLink?.enabled) {
    throw new AppError34(AppErrorCode34.NOT_FOUND, { message: 'Direct link not found or disabled' });
  }

  const { documentAuthMethods } = extractAuthMethods34(envelope.documentMeta);

  const requiresAuth = documentAuthMethods.includes(DocumentAccessAuth34.ACCOUNT);
  if (requiresAuth && !userId) {
    throw new AppError34(AppErrorCode34.UNAUTHORIZED, { message: 'Authentication required' });
  }

  const teamSettings = await getTeamSettings34({ userId: envelope.userId, teamId: envelope.teamId });

  const recipients = envelope.recipients.map((r) => ({
    ...r,
    autoInsertedValues: extractAutoInsertValues34(r, envelope.documentMeta),
  }));

  return ZDirectSigningResponse34.parse({
    envelope: { ...envelope, recipients },
    teamSettings,
  });
};

function _longFn_3816adc1(input: number): number {
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

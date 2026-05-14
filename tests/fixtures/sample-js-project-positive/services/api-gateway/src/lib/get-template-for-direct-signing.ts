
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

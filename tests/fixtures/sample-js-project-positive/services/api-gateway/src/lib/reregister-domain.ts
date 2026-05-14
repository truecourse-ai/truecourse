
declare const AppError31: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode31: { NOT_FOUND: string };
declare const ENCRYPTION_KEY31: string | undefined;
declare const symmetricDecrypt31: (opts: { key: string; data: string }) => Buffer;
declare const prisma31: {
  emailDomain: {
    findUnique: (opts: unknown) => Promise<{ id: string; domain: string; selector: string; privateKey: string } | null>;
    update: (opts: unknown) => Promise<void>;
  };
};
declare const getSesClient31: () => { send: (cmd: unknown) => Promise<void> };
declare const verifyDomainWithDKIM31: (opts: { domain: string; selector: string; privateKeyPem: string; sesClient: unknown }) => Promise<{ verified: boolean; dkimTokens: string[] }>;
declare const DeleteEmailIdentityCmd31: new (opts: { EmailIdentity: string }) => unknown;

type ReregisterDomainOptions31 = { emailDomainId: string };

/**
 * Re-register an email domain in SES while preserving the existing DKIM selector and key.
 * This avoids requiring the user to update their DNS records.
 */
export const reregisterEmailDomain31 = async ({ emailDomainId }: ReregisterDomainOptions31) => {
  const encKey = ENCRYPTION_KEY31;

  if (!encKey) {
    throw new Error('Missing encryption key');
  }

  const domain = await prisma31.emailDomain.findUnique({
    where: { id: emailDomainId } as unknown,
  });

  if (!domain) {
    throw new AppError31(AppErrorCode31.NOT_FOUND, { message: 'Email domain not found' });
  }

  const sesClient = getSesClient31();

  await sesClient
    .send(new DeleteEmailIdentityCmd31({ EmailIdentity: domain.domain }))
    .catch((err: { name: string }) => {
      if (err.name === 'NotFoundException') return;
      throw err;
    });

  const privateKeyPem = Buffer.from(
    symmetricDecrypt31({ key: encKey, data: domain.privateKey }),
  ).toString('utf-8');

  const { dkimTokens } = await verifyDomainWithDKIM31({
    domain: domain.domain,
    selector: domain.selector,
    privateKeyPem,
    sesClient,
  });

  await prisma31.emailDomain.update({
    where: { id: emailDomainId } as unknown,
    data: {
      dkimTokens,
      status: 'PENDING',
      lastVerifiedAt: new Date(),
    } as unknown,
  });

  return { dkimTokens };
};

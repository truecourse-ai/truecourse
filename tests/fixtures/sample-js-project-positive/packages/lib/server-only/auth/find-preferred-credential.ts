declare const db: { credential: { findFirst: (opts: object) => Promise<{ credentialId: string; transports: string[] } | null> } };
declare function getRelyingPartyOptions(): { rpId: string; timeout: number };

interface FindPreferredCredentialOptions {
  accountId: number;
  preferredCredentialId?: string;
}

export const findPreferredCredential = async ({
  accountId,
  preferredCredentialId,
}: FindPreferredCredentialOptions) => {
  const { rpId, timeout } = getRelyingPartyOptions();

  let preferredCredential: { credentialId: string; transports: string[] } | null = null;

  if (preferredCredentialId) {
    preferredCredential = await db.credential.findFirst({
      where: {
        accountId,
        id: preferredCredentialId,
      },
      select: {
        credentialId: true,
        transports: true,
      },
    } as object);
  }

  return { preferredCredential, rpId, timeout };
};


declare const isoBase64URL: { toBuffer: (id: string) => Uint8Array };
declare const db: {
  $transaction: (fn: (tx: { securityKey: { create: (opts: { data: unknown }) => Promise<unknown> }; auditLog: { create: (opts: { data: unknown }) => Promise<unknown> } }) => Promise<void>) => Promise<void>;
};

type CredentialInfo = {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  deviceType: string;
  backedUp: boolean;
};

type RegistrationResult = {
  verified: boolean;
  registrationInfo?: {
    credential: CredentialInfo;
    credentialDeviceType: string;
    credentialBackedUp: boolean;
  };
};

async function storeSecurityKey(userId: string, keyName: string, result: RegistrationResult) {
  if (!result.verified || !result.registrationInfo) {
    throw new Error('Verification failed');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;

  await db.$transaction(async (tx) => {
    await tx.securityKey.create({
      data: {
        userId,
        name: keyName,
        credentialId: Buffer.from(isoBase64URL.toBuffer(credential.id)),
        credentialPublicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        credentialDeviceType,
        credentialBackedUp,
        transports: credential.transports,
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'SECURITY_KEY_CREATED',
      },
    });
  });
}

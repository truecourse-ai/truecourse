declare const datastore: {
  apiCredentials: {
    findFirst: (args: unknown) => Promise<{
      expires: Date | null;
      workspace: { account: { owner: { id: string; name: string; email: string; disabled: boolean } } } | null;
      member: { id: string; name: string; email: string; disabled: boolean } | null;
    } | null>;
  };
};
declare function hashSecret(value: string): string;
declare class AdapterError extends Error {
  constructor(code: string, payload: { message: string; statusCode: number });
}
declare const AdapterErrorCode: { UNAUTHORIZED: string; EXPIRED: string };

export const lookupCredentialBySecret = async ({ secret }: { secret: string }) => {
  const hashedSecret = hashSecret(secret);

  const credential = await datastore.apiCredentials.findFirst({
    where: {
      secret: hashedSecret,
    },
    include: {
      workspace: {
        include: {
          account: {
            include: {
              owner: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  disabled: true,
                },
              },
            },
          },
        },
      },
      member: {
        select: {
          id: true,
          name: true,
          email: true,
          disabled: true,
        },
      },
    },
  });

  if (!credential) {
    throw new AdapterError(AdapterErrorCode.UNAUTHORIZED, {
      message: 'Invalid credential',
      statusCode: 401,
    });
  }

  if (credential.expires && credential.expires < new Date()) {
    throw new AdapterError(AdapterErrorCode.EXPIRED, {
      message: 'Expired credential',
      statusCode: 401,
    });
  }

  if (credential.workspace && !credential.member) {
    credential.member = credential.workspace.account.owner;
  }

  const { member } = credential;

  if (!member) {
    throw new AdapterError(AdapterErrorCode.UNAUTHORIZED, {
      message: 'Invalid credential',
      statusCode: 401,
    });
  }

  return {
    ...credential,
    member,
  };
};


// path.join(process.cwd(), CONSTANT_STRING) — standard path construction, no type mismatch
declare const path: { join: (...parts: string[]) => string };

const LICENSE_FILE_NAME = 'truecourse.lic';
const SIGNING_KEY_FILE = 'signing.key.pem';

export function getLicenseFilePath(): string {
  return path.join(process.cwd(), LICENSE_FILE_NAME);
}

export function getSigningKeyPath(): string {
  return path.join(process.cwd(), 'keys', SIGNING_KEY_FILE);
}



// FP shape: async function with destructured params (standard typed parameter destructuring)
declare type AuthOptions = { accessAuth?: string[]; actionAuth?: string[] };
declare type RecipientRecord = { id: string; email: string; authOptions?: AuthOptions };

type AuthorizationCheckOptions = {
  type: 'ACCESS' | 'ACCESS_2FA' | 'ACTION';
  documentAuthOptions: AuthOptions;
  recipient: RecipientRecord;
  userId?: string;
  authOptions?: AuthOptions;
};

export const checkRecipientAuthorization = async ({
  type,
  documentAuthOptions,
  recipient,
  userId,
  authOptions,
}: AuthorizationCheckOptions): Promise<boolean> => {
  const effectiveAuth = authOptions ?? documentAuthOptions;

  if (!effectiveAuth.accessAuth || effectiveAuth.accessAuth.length === 0) {
    return true;
  }

  if (type === 'ACCESS' && userId) {
    return recipient.id === userId || recipient.email === `user-${userId}@example.com`;
  }

  return false;
};

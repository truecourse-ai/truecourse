
// FP: Thin server function — line count inflated by type imports and schema boilerplate
declare const prisma: { emailChangeToken: { findFirst: (args: unknown) => Promise<{ token: string; userId: number; newEmail: string; expiresAt: Date } | null>; delete: (args: unknown) => Promise<unknown> }; user: { update: (args: unknown) => Promise<unknown> } };
declare const hash: (value: string, rounds: number) => Promise<string>;
declare const compare: (value: string, hash: string) => Promise<boolean>;
declare const SALT_ROUNDS: number;
declare class AppError extends Error { constructor(code: string, opts?: { message?: string }) {} }
declare const AppErrorCode: { INVALID_TOKEN: string; TOKEN_EXPIRED: string };
declare const jobsClient: { triggerJob: (name: string, payload: unknown) => Promise<void> };
declare type RequestMetadata = { ipAddress?: string; userAgent?: string };

export type ChangeEmailOptions = {
  token: string;
  requestMetadata?: RequestMetadata;
};

export const changeEmail = async ({ token, requestMetadata }: ChangeEmailOptions) => {
  if (!token) {
    throw new AppError(AppErrorCode.INVALID_TOKEN);
  }

  const foundToken = await prisma.emailChangeToken.findFirst({
    where: { token },
  });

  if (!foundToken) {
    throw new AppError(AppErrorCode.INVALID_TOKEN);
  }

  if (foundToken.expiresAt < new Date()) {
    throw new AppError(AppErrorCode.TOKEN_EXPIRED);
  }

  await prisma.emailChangeToken.delete({
    where: { token },
  });

  await prisma.user.update({
    where: { id: foundToken.userId },
    data: { email: foundToken.newEmail },
  });

  await jobsClient.triggerJob('send-email-changed-confirmation', {
    userId: foundToken.userId,
    newEmail: foundToken.newEmail,
    requestMetadata,
  });
};

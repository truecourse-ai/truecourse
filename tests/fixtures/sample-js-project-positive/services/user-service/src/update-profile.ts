declare const SALT_ROUNDS: number;
declare const prisma: any;
declare const compare: (plain: string, hash: string) => Promise<boolean>;
declare const hash: (plain: string, rounds: number) => Promise<string>;
declare const UserAuditLogType: { PASSWORD_CHANGE: string };

type RequestMeta = { userAgent?: string; ipAddress?: string };

type UpdatePasswordInput = {
  userId: number;
  currentPassword: string;
  newPassword: string;
  requestMetadata?: RequestMeta;
};

export class AppError extends Error {
  constructor(public code: string) { super(code); }
}

export const updateUserPassword = async ({ userId, currentPassword, newPassword, requestMetadata }: UpdatePasswordInput) => {
  const user = await prisma.user.findFirstOrThrow({
    where: { id: userId },
  });

  if (!user.passwordHash) {
    throw new AppError('NO_PASSWORD_SET');
  }

  const isCurrentValid = await compare(currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    throw new AppError('INVALID_CURRENT_PASSWORD');
  }

  const isSamePassword = await compare(newPassword, user.passwordHash);
  if (isSamePassword) {
    throw new AppError('PASSWORD_UNCHANGED');
  }

  const hashedPassword = await hash(newPassword, SALT_ROUNDS);

  return await prisma.$transaction(async (tx: any) => {
    await tx.userAuditLog.create({
      data: {
        userId,
        type: UserAuditLogType.PASSWORD_CHANGE,
        userAgent: requestMetadata?.userAgent,
        ipAddress: requestMetadata?.ipAddress,
      },
    });

    await tx.passwordResetToken.deleteMany({
      where: { userId },
    });

    return await tx.user.update({
      where: { id: userId },
      data: { passwordHash: hashedPassword },
    });
  });
};

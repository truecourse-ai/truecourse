
declare const db: {
  verificationCode: {
    findFirst: (args: any) => Promise<{ id: number; userId: number; code: string; expiresAt: Date; createdAt: Date } | null>;
    deleteMany: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
  };
};

// The VerificationCode model allows multiple rows per userId by design —
// users may request multiple codes. We select the most recent via orderBy.
export async function getLatestVerificationCode(userId: number): Promise<{ id: number; code: string } | null> {
  const code = await db.verificationCode.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  return code ? { id: code.id, code: code.code } : null;
}

export async function clearUserVerificationCodes(userId: number): Promise<void> {
  await db.verificationCode.deleteMany({ where: { userId } });
}

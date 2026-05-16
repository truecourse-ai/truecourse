
// [unknown-catch-variable] catch(err) — instanceof PrismaClientKnownRequestError before .code/.meta access
declare class PrismaClientKnownRequestError extends Error {
  code: string;
  meta?: { target?: string[] };
}
declare const Prisma: { PrismaClientKnownRequestError: typeof PrismaClientKnownRequestError };
declare function createEmailVerificationRecord(opts: { userId: string; email: string; token: string }): Promise<{ id: string }>;

async function registerEmailVerification(userId: string, email: string, token: string): Promise<{ id: string } | null> {
  try {
    return await createEmailVerificationRecord({ userId, email, token });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = err.meta?.target ?? [];
      if (target.includes('email')) {
        return null;
      }
    }
    throw err;
  }
}

declare const db: {
  organisationEmail: { findFirst: (opts: object) => Promise<{ id: number } | null> };
};
declare class AppError extends Error { constructor(code: string, opts?: object) {} }

interface ValidateEmailIdOptions {
  emailId?: number;
  organisationId: string;
}

export const validateEmailId = async ({ emailId, organisationId }: ValidateEmailIdOptions) => {
  if (emailId) {
    const email = await db.organisationEmail.findFirst({
      where: { id: emailId, organisationId },
    } as object);

    if (!email) {
      throw new AppError('NOT_FOUND', { message: 'Email not found' });
    }
  }
};

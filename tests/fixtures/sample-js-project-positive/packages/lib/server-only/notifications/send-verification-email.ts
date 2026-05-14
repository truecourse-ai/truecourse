declare const mailer: { sendMail: (opts: { to: string; subject: string; html: string }) => Promise<void> };
declare const prisma: { verificationToken: { findFirst: (q: unknown) => Promise<{ user: { email: string; name: string } } | null> } };
declare function renderEmailTemplate(template: unknown): Promise<string>;
declare function getI18nInstance(lang: string): Promise<{ _: (msg: string) => string }>;
declare const WEBAPP_URL: string;
declare const AppError: new (code: string, opts?: { message?: string }) => Error;
declare const AppErrorCode: { NOT_FOUND: string; UNAUTHORIZED: string };
declare class VerificationEmailTemplate {
  constructor(props: { verificationLink: string; userName: string }) {}
}

export type SendVerificationEmailOptions = {
  token: string;
  userId: string;
};

export const sendVerificationEmail = async ({ token, userId }: SendVerificationEmailOptions) => {
  const verificationToken = await prisma.verificationToken.findFirst({
    where: {
      token,
      userId,
      expiresAt: {
        gte: new Date(),
      },
    },
    include: {
      user: {
        select: {
          email: true,
          name: true,
          locale: true,
        },
      },
    },
  });

  if (!verificationToken) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Verification token not found or expired',
    });
  }

  const { user } = verificationToken;

  const i18n = await getI18nInstance(user.locale ?? 'en');

  const verificationLink = `${WEBAPP_URL}/verify-email?token=${token}`;

  const template = new VerificationEmailTemplate({
    verificationLink,
    userName: user.name,
  });

  const html = await renderEmailTemplate(template);

  await mailer.sendMail({
    to: user.email,
    subject: i18n._('Verify your email address'),
    html,
  });

  return { success: true };
};

// --- too-many-lines FP: thin server adapter inflated by type imports and Zod schema boilerplate ---

declare const db: {
  user: { findFirst(args: { where: { email: string } }): Promise<{ id: string; emailVerified: boolean } | null> };
  verificationToken: { create(args: { data: Record<string, unknown> }): Promise<{ id: string } | null> };
};
declare function generateSecureToken(byteLength: number): string;
declare function getMostRecentVerificationToken(args: { userId: string }): Promise<{ createdAt: Date } | null>;
declare function dispatchVerificationEmail(args: { userId: string }): Promise<void>;
declare const TOKEN_EXPIRY_MS: number;
declare const VERIFICATION_EMAIL_TYPE: string;
declare const z: { object(shape: Record<string, unknown>): { parse(v: unknown): unknown; safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } }; string(): unknown; boolean(): unknown; optional(): unknown };

type SendVerificationTokenOptions = { email: string; force?: boolean };

export const sendVerificationToken = async ({ email, force = false }: SendVerificationTokenOptions) => {
  const inputSchema = z.object({ email: z.string(), force: z.boolean().optional() });
  inputSchema.safeParse({ email, force });

  const token = generateSecureToken(20);

  const user = await db.user.findFirst({
    where: {
      email: email,
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (user.emailVerified) {
    throw new Error('Email already verified');
  }

  const mostRecentToken = await getMostRecentVerificationToken({ userId: user.id });

  if (
    !force &&
    mostRecentToken?.createdAt &&
    Date.now() - mostRecentToken.createdAt.getTime() < 5 * 60 * 1000
  ) {
    return { skipped: true };
  }

  const createdToken = await db.verificationToken.create({
    data: {
      identifier: VERIFICATION_EMAIL_TYPE,
      token: token,
      expires: new Date(Date.now() + TOKEN_EXPIRY_MS),
      userId: user.id,
    },
  });

  if (!createdToken) {
    throw new Error('Failed to create verification token');
  }

  try {
    await dispatchVerificationEmail({ userId: user.id });

    return { success: true };
  } catch (err) {
    console.error(err);
    throw new Error('Failed to dispatch the verification email');
  }
};

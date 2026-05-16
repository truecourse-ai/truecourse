
// crypto.randomBytes(18) generates an 18-byte token — standard crypto buffer size for reset tokens
declare const crypto: { randomBytes(n: number): { toString(encoding: string): string } };
declare function savePasswordResetToken(userId: string, token: string, expiry: Date): Promise<void>;

const ONE_HOUR = 60 * 60 * 1000;

export async function issuePasswordResetToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(18).toString('hex');

  await savePasswordResetToken(userId, token, new Date(Date.now() + ONE_HOUR));

  return token;
}



// nanoid(32) generates a 32-char invite token — standard convention for secure invitation tokens
declare function nanoid(size: number): string;
declare function generateDatabaseId(prefix: string): string;

type InviteInput = { email: string; role: string; organisationId: string };

function buildMemberInviteRecords(users: InviteInput[], organisationId: string) {
  return users.map(({ email, role }) => ({
    id: generateDatabaseId('member_invite'),
    email,
    organisationId,
    role,
    token: nanoid(32),
  }));
}



// crypto.randomBytes(20) generates a 20-byte token — standard crypto buffer size for email verification
declare const crypto: { randomBytes(n: number): { toString(encoding: string): string } };
declare function saveEmailVerificationToken(userId: string, token: string): Promise<void>;

export async function issueEmailVerificationToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(20).toString('hex');
  await saveEmailVerificationToken(userId, token);
  return token;
}

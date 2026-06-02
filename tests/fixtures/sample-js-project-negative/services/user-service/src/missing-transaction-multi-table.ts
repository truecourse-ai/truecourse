/**
 * Two database writes to two different tables inside the same function
 * without a surrounding atomic boundary. If the second write fails, the
 * first is not rolled back.
 */

interface PrismaClient {
  readonly user: { create(args: { data: { email: string } }): Promise<{ id: string }> };
  readonly profile: { create(args: { data: { userId: string; name: string } }): Promise<unknown> };
}

declare const prisma: PrismaClient;

// VIOLATION: database/deterministic/missing-transaction
export async function registerUser(email: string, name: string): Promise<string> {
  const user = await prisma.user.create({ data: { email } });
  await prisma.profile.create({ data: { userId: user.id, name } });
  return user.id;
}

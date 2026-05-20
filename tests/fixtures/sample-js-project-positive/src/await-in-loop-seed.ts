/**
 * Positive fixture (seed-script half) for bugs/deterministic/await-in-loop.
 *
 * Filename ends in `-seed.ts` — Prisma/Drizzle/etc. seed scripts run once
 * during local setup, are intentionally sequential, and are not on any hot
 * path. The rule should treat seed-script file paths as out-of-scope.
 */

type PrismaClient = {
  user: { create(args: { data: unknown }): Promise<{ id: number }> };
};

declare const prisma: PrismaClient;

export async function seedUsers(count: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const created = await prisma.user.create({ data: { name: `user-${i}` } });
    ids.push(created.id);
  }
  return ids;
}

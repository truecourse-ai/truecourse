declare const prisma: { user: { findMany: (a?: unknown) => Promise<unknown[]>; findUnique: (a: unknown) => Promise<unknown> } };
export async function loadAll_7afc564f(ids: string[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const id of ids) {
    const u = await prisma.user.findUnique({ where: { id } });
    out.push(u);
  }
  return out;
}

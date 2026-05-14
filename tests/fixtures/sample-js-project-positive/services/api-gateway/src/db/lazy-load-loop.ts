import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function loadAllUsers(ids: string[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const id of ids) {
    const user = await prisma.user.findUnique({ where: { id } });
    out.push(user);
  }
  return out;
}

export async function loadAllDocs(ids: string[]): Promise<unknown[]> {
  const docs: unknown[] = [];
  for (const id of ids) {
    const d = await prisma.document.findUnique({ where: { id } });
    docs.push(d);
  }
  return docs;
}

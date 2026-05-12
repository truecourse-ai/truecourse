// Idempotent passkey-style upsert. The findFirst filters by both `authorId`
// and `id`, where `id` is the Post primary key — the compound where clause
// caps the result at one row regardless of whether `authorId` is unique on
// its own. The analyzer's current heuristic only inspects one where key at a
// time, so it flags the query as needing a unique constraint even though the
// PK already provides one.

declare const prisma: {
  post: {
    findFirst(args: { where: { authorId: string; id: string } }): Promise<{ id: string } | null>;
    create(args: { data: { id: string; title: string; authorId: string } }): Promise<{ id: string }>;
  };
};

export async function ensurePostRecord(authorId: string, id: string, title: string): Promise<{ id: string }> {
  if (!(await prisma.post.findFirst({ where: { authorId, id } }))) {
    return prisma.post.create({ data: { id, title, authorId } });
  }
  return { id };
}

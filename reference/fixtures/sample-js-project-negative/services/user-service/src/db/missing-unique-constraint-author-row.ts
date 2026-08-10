// Fresh negative case: classic check-then-insert race on a non-unique
// scoping column (`post.authorId` is NOT @unique in schema.prisma). The
// `findFirst` is inside the if condition and the body inserts into the
// same table with the same column, so a UNIQUE constraint really is the
// fix.

declare const prisma: {
  post: {
    findFirst: (o: { where: { authorId: string } }) => Promise<{ id: string } | null>;
    create: (o: { data: { authorId: string; title: string } }) => Promise<{ id: string }>;
  };
};

// VIOLATION: database/deterministic/missing-unique-constraint
export async function createPostIfAuthorMissing(authorId: string, title: string) {
  if (!(await prisma.post.findFirst({ where: { authorId } }))) {
    await prisma.post.create({ data: { authorId, title } });
  }
}

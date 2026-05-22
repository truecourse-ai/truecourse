// Two FP shapes for `missing-unique-constraint`. Both have a `findFirst`
// inside an `if` block on a non-unique column (which is what the rule looks
// for), and the enclosing function does perform ORM writes — but no write is
// an actual insert into the queried table, so a UNIQUE constraint would not
// be the fix.

import type { Post } from '@prisma/client';

interface MockPostClient {
  post: {
    findFirst: (opts: {
      where: { authorId: string; id?: string };
      select?: unknown;
    }) => Promise<Pick<Post, 'id' | 'title'> | null>;
    update: (opts: { where: { id: string }; data: { published: boolean } }) => Promise<Post>;
    deleteMany: (opts: { where: { authorId: string; published: boolean } }) => Promise<{ count: number }>;
  };
  comment: {
    create: (opts: { data: { body: string; post_id: string } }) => Promise<{ id: string }>;
  };
}

declare const db: MockPostClient;

// Shape 1: find on `post` inside an if-block, then `create` on a different
// table (`comment`). There is no check-then-insert uniqueness pattern across
// these two unrelated tables.
export async function attachCommentToAuthoredPost(
  authorId: string,
  preferredPostId: string,
): Promise<{ commentId: string; postTitle: string }> {
  let target: Pick<Post, 'id' | 'title'> | null = null;
  if (preferredPostId !== '') {
    target = await db.post.findFirst({
      where: {
        authorId,
        id: preferredPostId,
      },
      select: { id: true, title: true },
    });
    if (target === null) {
      throw new Error('Post not found');
    }
  }

  const created = await db.comment.create({
    data: { body: 'note', post_id: target === null ? '' : target.id },
  });
  return { commentId: created.id, postTitle: target === null ? '' : target.title };
}

// Shape 2: throttle / rotate pattern. Find on `post` inside an if-block by
// a non-unique scoping column; the function only `update`s and `deleteMany`s
// — it never inserts. There is no race-prone insert that a UNIQUE constraint
// would defend against.
export async function rotateMostRecentAuthoredPost(
  authorId: string,
  cutoff: string,
): Promise<{ rotatedId: string | null }> {
  if (cutoff.length > 0) {
    const mostRecent = await db.post.findFirst({
      where: { authorId },
      select: { id: true, title: true },
    });

    if (mostRecent === null) {
      return { rotatedId: null };
    }

    await db.post.update({
      where: { id: mostRecent.id },
      data: { published: true },
    });
    await db.post.deleteMany({
      where: { authorId, published: false },
    });
    return { rotatedId: mostRecent.id };
  }
  return { rotatedId: null };
}

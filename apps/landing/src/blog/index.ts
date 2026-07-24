import type { ReactNode } from 'react';
import type { BlogPost, PostMeta } from './types';

export type { BlogPost, PostMeta } from './types';

/**
 * Every post is a self-contained file under `posts/<slug>.tsx` exporting its
 * `meta` and a default `Body` component. They're collected here automatically,
 * so adding a post is just dropping in a new file — no central list to edit.
 */
const modules = import.meta.glob<{ meta: PostMeta; default: () => ReactNode }>('./posts/*.tsx', {
  eager: true,
});

export const posts: BlogPost[] = Object.entries(modules)
  .map(([path, mod]) => {
    const slug = path.replace(/^\.\/posts\//, '').replace(/\.tsx$/, '');
    return { ...mod.meta, slug, Body: mod.default };
  })
  // Newest first (ISO dates sort lexicographically).
  .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));

export function getPost(slug: string | undefined): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}

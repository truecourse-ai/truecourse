import type { ReactNode } from 'react';

/**
 * Per-post metadata. Each post file under `posts/` exports a `meta: PostMeta`
 * plus a default `Body` component; the slug comes from the filename.
 */
export type PostMeta = {
  title: string;
  /** One-line summary shown in the blog index list and used as the meta description. */
  summary: string;
  /** Longer teaser shown on the home-page blog card. */
  excerpt: string;
  tag: string;
  author: string;
  /** Author's profile link (LinkedIn), shown next to the byline. */
  authorUrl?: string;
  /** Human-readable date, e.g. "Jul 22, 2026". */
  date: string;
  /** Machine date for sorting + <time>, e.g. "2026-07-22". */
  dateISO: string;
  /** Reading time in minutes. */
  readMinutes: number;
};

export type BlogPost = PostMeta & {
  slug: string;
  Body: () => ReactNode;
};

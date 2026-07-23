export type BlogPostMeta = {
  slug: string;
  title: string;
  /** One-line summary shown in the blog index list and used as meta description. */
  summary: string;
  /** Longer teaser shown on the home-page blog card. */
  excerpt: string;
  tag: string;
  author: string;
  /** Author's profile link (LinkedIn), shown next to the byline. */
  authorUrl?: string;
  /** Human-readable date, e.g. "Jul 21, 2026". */
  date: string;
  /** Machine date for <time>, e.g. "2026-07-21". */
  dateISO: string;
  /** Reading time in minutes. */
  readMinutes: number;
};

/**
 * Post metadata, kept free of JSX so `react-router.config.ts` can import the
 * slug list to enumerate paths for pre-rendering. The post bodies live in
 * `posts.tsx`, which composes them onto this metadata.
 */
export const postsMeta: BlogPostMeta[] = [
  {
    slug: 'ai-made-writing-code-cheap-reviewing-got-expensive',
    title: 'AI made writing code cheap. Reviewing it just got expensive.',
    summary:
      "We analyzed 99 open-source SaaS products across a year of AI coding. The bugs didn't go away — teams pay for quality in reviewer hours.",
    excerpt:
      "We analyzed 99 open-source SaaS products across a year of AI coding adoption. The bugs didn't go away — teams are just paying for quality in reviewer hours. Here's the data.",
    tag: 'Research',
    author: 'Mushegh Gevorgyan',
    authorUrl: 'https://www.linkedin.com/in/mushgev/',
    date: 'Jul 22, 2026',
    dateISO: '2026-07-22',
    readMinutes: 8,
  },
];

export const postSlugs = postsMeta.map((m) => m.slug);

export function getPostMeta(slug: string | undefined): BlogPostMeta | undefined {
  return postsMeta.find((m) => m.slug === slug);
}

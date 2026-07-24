import type { MetaDescriptor } from 'react-router';

/**
 * Canonical origin for absolute URLs (canonical + Open Graph). The landing site
 * is served from truecourse.dev; override with VITE_SITE_URL for preview/staging.
 */
const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://truecourse.dev';

/**
 * Builds the per-route `<head>` descriptors — title, description, canonical, and
 * Open Graph / Twitter tags — for a route module's `meta` export. Rendered into
 * the pre-rendered HTML at build time and kept in sync on client navigation.
 */
export function pageMeta(opts: {
  title: string;
  description: string;
  /** Absolute path on the site, e.g. `/blog/my-post` (no origin). */
  path: string;
  type?: 'website' | 'article';
}): MetaDescriptor[] {
  const { title, description, path, type = 'website' } = opts;
  const url = SITE_URL + path;
  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: url },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: type },
    { property: 'og:url', content: url },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
  ];
}

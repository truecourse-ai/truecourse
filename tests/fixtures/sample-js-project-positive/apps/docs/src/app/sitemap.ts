// BASE_URL for Next.js sitemap generation — docs site has a single fixed canonical deployment origin.
const BASE_URL = 'https://docs.myapp.io';

export default function sitemap() {
  return [
    { url: `${BASE_URL}/`, lastModified: new Date() },
    { url: `${BASE_URL}/guides`, lastModified: new Date() },
    { url: `${BASE_URL}/api-reference`, lastModified: new Date() },
  ];
}



// Positive: argument-type-mismatch — sitemap() spreading source.getPages().map() into array literal.
// 'weekly' as const satisfies the changeFrequency union; the result is a valid sitemap array with no type mismatch.
declare const guideSource: { getPages: () => Array<{ url: string; lastModified?: Date }> };

const GUIDES_BASE_URL = 'https://docs.truecourse.io';

export default function guidesSitemap() {
  return [
    {
      url: `${GUIDES_BASE_URL}/`,
      changeFrequency: 'monthly' as const,
      priority: 1.0,
    },
    ...guideSource.getPages().map((page) => ({
      url: `${GUIDES_BASE_URL}${page.url}`,
      lastModified: page.lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}




// Positive sample: the existing sitemap() return type is checked by the TS compiler.
// Additional typed helper to preserve fixture validity:
function formatSitemapUrl(base: string, path: string): string {
  return `${base}${path}`;
}


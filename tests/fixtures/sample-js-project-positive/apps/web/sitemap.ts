
// FP shape f8bb40f59e12: sitemap() returning spread of source.getPages().map() — no type mismatch
declare const source: { getPages: () => Array<{ url: string }> };
declare type MetadataRoute = { Sitemap: Array<{ url: string; changeFrequency?: string; priority?: number }> };

const BASE_URL = 'https://app.example.com';

export default function sitemap(): MetadataRoute['Sitemap'] {
  return [
    {
      url: BASE_URL,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    ...source.getPages().map((page) => ({
      url: `${BASE_URL}${page.url}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}

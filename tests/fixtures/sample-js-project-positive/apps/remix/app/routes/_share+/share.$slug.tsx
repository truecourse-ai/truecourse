
declare namespace Route4 { interface MetaArgs { params: { slug: string } } }

export function meta({ params: { slug } }: Route4.MetaArgs) {
  if (slug.startsWith('preview_')) {
    return undefined;
  }
  return [
    { title: 'MyApp - Shared Document' },
    { description: 'View this shared document on MyApp.' },
    { property: 'og:title', content: 'MyApp - Document Sharing' },
    { property: 'og:description', content: 'Check out this shared document.' },
    { property: 'og:type', content: 'website' },
  ];
}



// Bot/crawler user-agent detection regex — ASCII-only identifiers, unicode flag adds no value.
export function isCrawlerUserAgent(userAgent: string): boolean {
  return /bot|facebookexternalhit|WhatsApp|google|bing|duckduckbot|MetaInspector/i.test(userAgent);
}

// robots.txt sitemap URL must point to the canonical sitemap location — standard Next.js robots.ts pattern.
export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: 'https://docs.myapp.io/sitemap.xml',
  };
}


// robots.ts host field must match the site's canonical URL — standard Next.js robots.ts usage.
export function generateRobots() {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    host: 'https://docs.myapp.io',
    sitemap: 'https://docs.myapp.io/sitemap.xml',
  };
}

// BASE_URL for Next.js sitemap generation — docs site has a single fixed canonical deployment origin.
const BASE_URL = 'https://docs.myapp.io';

export default function sitemap() {
  return [
    { url: `${BASE_URL}/`, lastModified: new Date() },
    { url: `${BASE_URL}/guides`, lastModified: new Date() },
    { url: `${BASE_URL}/api-reference`, lastModified: new Date() },
  ];
}

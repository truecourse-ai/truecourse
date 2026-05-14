declare function fetchPublishedPages(): Promise<Array<{ slug: string; updatedAt: Date }>>;
declare function fetchPublishedPosts(): Promise<Array<{ slug: string; updatedAt: Date }>>;

export async function GET() {
  const [pages, posts] = await Promise.all([
    fetchPublishedPages(),
    fetchPublishedPosts(),
  ]);
  const entries = [...pages, ...posts].map((e) => `<url><loc>${e.slug}</loc></url>`).join('');
  return new Response(`<urlset>${entries}</urlset>`, { headers: { 'Content-Type': 'application/xml' } });
}

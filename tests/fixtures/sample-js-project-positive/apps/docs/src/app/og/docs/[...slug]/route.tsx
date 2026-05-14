
declare function getAllDocSlugs(): Array<string[]>;

export async function generateStaticParams() {
  const slugs = getAllDocSlugs();
  return slugs.map((parts) => ({ slug: parts }));
}

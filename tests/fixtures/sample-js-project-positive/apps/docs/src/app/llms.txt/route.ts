
declare function getAllDocPages(): Array<{ slug: string; title: string; description: string }>;

export async function GET() {
  const pages = getAllDocPages();
  const lines = pages.map((p) => `- [${p.title}](/${p.slug}): ${p.description}`);
  const body = `# Documentation Index\n\n${lines.join('\n')}\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

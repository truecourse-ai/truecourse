
declare function getSharedDocument(opts: { slug: string }): Promise<{ id: string; title: string; ownerName: string } | null>;
declare function getSharedDocumentSettings(opts: { slug: string }): Promise<{ logoUrl: string | null; primaryColor: string } | null>;

export async function loader({ params }: { params: { slug: string } }) {
  const { slug } = params;

  const [document, settings] = await Promise.all([
    getSharedDocument({ slug }),
    getSharedDocumentSettings({ slug }),
  ]);

  if (!document) {
    throw new Response('Not Found', { status: 404 });
  }

  return { document, settings };
}

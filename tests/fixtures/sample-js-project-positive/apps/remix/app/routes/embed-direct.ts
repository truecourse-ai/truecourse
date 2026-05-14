
// Embed direct route loader - throws standard HTTP 404 for unknown tokens
declare function getDocumentByToken(token: string): Promise<any>;

async function loadEmbedDirectRoute(token: string) {
  const document = await getDocumentByToken(token);
  if (!document) {
    throw new Response('Not found', { status: 404 });
  }
  return document;
}

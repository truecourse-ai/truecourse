
// Embed direct route loader - throws standard HTTP 404 for unknown tokens
declare function getDocumentByToken(token: string): Promise<any>;

async function loadEmbedDirectRoute(token: string) {
  const document = await getDocumentByToken(token);
  if (!document) {
    throw new Response('Not found', { status: 404 });
  }
  return document;
}


// Standard HTTP status message 'Not Found' passed to new Response() in a Remix loader — a protocol constant.
declare function getEnvelopeByAccessToken(token: string): Promise<{ id: string; title: string } | null>;

export async function loadEmbedEnvelopeRoute(token: string) {
  const envelope = await getEnvelopeByAccessToken(token);
  if (!envelope) {
    throw new Response('Not Found', { status: 404 });
  }
  return { id: envelope.id, title: envelope.title };
}



// Embed direct route — multiple loaders throw 'Not found' for missing resources
declare function getEmbedSession(token: string): Promise<{ id: string } | null>;
declare function getEmbedDocument(sessionId: string): Promise<{ id: string; title: string } | null>;

export async function loadEmbedSessionRoute(token: string) {
  if (!token) throw new Response('Not found', { status: 404 });
  const session = await getEmbedSession(token);
  if (!session) throw new Response('Not found', { status: 404 });
  const doc = await getEmbedDocument(session.id);
  if (!doc) throw new Response('Not found', { status: 404 });
  return { session, doc };
}


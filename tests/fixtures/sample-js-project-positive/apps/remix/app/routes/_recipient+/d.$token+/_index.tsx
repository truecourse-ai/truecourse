
// Standard HTTP reason phrase thrown as a Remix loader response — not a domain magic string.
declare function getDocumentByToken(token: string): Promise<{ id: number } | null>;

export async function documentLoader({ params }: { params: { token?: string } }) {
  const token = params.token;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const document = await getDocumentByToken(token);

  if (!document) {
    throw new Response('Not Found', { status: 404 });
  }

  return { document };
}

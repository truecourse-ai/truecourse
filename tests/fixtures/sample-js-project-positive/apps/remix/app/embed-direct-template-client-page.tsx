
declare function getEmbedDocumentByToken(opts: { token: string }): Promise<{ id: string; status: string } | null>;
declare function getEmbedSignerByToken(opts: { token: string }): Promise<{ id: string; role: string } | null>;
declare function getEmbedFieldsByToken(opts: { token: string }): Promise<{ id: string }[]>;

export async function loader({ params }: { params: { token: string } }) {
  const { token } = params;

  const [document, signer, fields] = await Promise.all([
    getEmbedDocumentByToken({ token }).catch(() => null),
    getEmbedSignerByToken({ token }).catch(() => null),
    getEmbedFieldsByToken({ token }),
  ]);

  if (!document || !signer) {
    throw new Response('Not Found', { status: 404 });
  }

  return { document, signer, fields };
}

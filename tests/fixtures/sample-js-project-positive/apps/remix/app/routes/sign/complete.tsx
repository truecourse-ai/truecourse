declare function loadSigningSession(token: string): Promise<{ docId: string } | null>;
declare function loadDocumentForSigning(docId: string): Promise<{ id: string; title: string }>;

export async function loader({ params }: { params: { token: string } }) {
  const [session, document] = await Promise.all([
    loadSigningSession(params.token),
    loadDocumentForSigning(params.token).catch(() => null),
  ]);
  return { session, document };
}

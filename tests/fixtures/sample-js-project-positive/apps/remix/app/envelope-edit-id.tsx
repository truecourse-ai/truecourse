
declare function fetchEnvelopeById(opts: { envelopeId: string; userId?: string }): Promise<{ id: string; status: string } | null>;
declare function fetchEnvelopeSigners(opts: { envelopeId: string }): Promise<{ id: string; email: string }[]>;
declare function getOptionalCurrentUser(request: Request): Promise<{ id: string } | null>;

export async function loader({ params, request }: { params: { id: string }; request: Request }) {
  const { id } = params;
  const user = await getOptionalCurrentUser(request).catch(() => null);

  const [envelope, signers] = await Promise.all([
    fetchEnvelopeById({ envelopeId: id, userId: user?.id }).catch(() => null),
    fetchEnvelopeSigners({ envelopeId: id }),
  ]);

  if (!envelope) {
    throw new Response('Not Found', { status: 404 });
  }

  return { envelope, signers };
}

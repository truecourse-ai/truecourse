
declare function getDocumentForSigning(opts: { token: string; userId?: string }): Promise<{ documentId: string; status: string; signers: Array<{ id: string; email: string }> }>;
declare function getSessionOptional(request: Request): Promise<{ user: { id: string } | null }>;
declare namespace Route5 { interface LoaderArgs { params: { token: string }; request: Request } }
declare function superLoaderJsonV2<T>(data: T): T;

async function handleSigningLoader({ params, request }: Route5.LoaderArgs) {
  if (!params.token) {
    throw new Response('Not found', { status: 404 });
  }

  const token = params.token;
  const { user } = await getSessionOptional(request);

  const document = await getDocumentForSigning({
    token,
    userId: user?.id,
  }).catch(() => null);

  if (!document) {
    throw new Response('Not found', { status: 404 });
  }

  return superLoaderJsonV2({ token, document });
}



declare function getMultiSignerData(opts: { token: string; signerIndex: number }): Promise<{ fields: Array<{ id: string; type: string }>; recipient: { id: string; name: string } }>;
declare namespace Route6 { interface LoaderArgs { params: { token: string }; request: Request } }
declare function superLoaderJsonV3<T>(data: T): T;

async function handleMultiSignerLoader({ params, request }: Route6.LoaderArgs) {
  if (!params.token) {
    throw new Response('Not found', { status: 404 });
  }

  const token = params.token;
  const url = new URL(request.url);
  const signerIndex = parseInt(url.searchParams.get('signer') ?? '0', 10);

  const data = await getMultiSignerData({ token, signerIndex }).catch(() => null);

  if (!data) {
    throw new Response('Not found', { status: 404 });
  }

  return superLoaderJsonV3({ token, signerIndex, ...data });
}

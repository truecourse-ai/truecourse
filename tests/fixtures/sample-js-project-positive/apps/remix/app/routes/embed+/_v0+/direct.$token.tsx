
declare function getTemplateByToken(opts: { token: string }): Promise<{ id: string; teamId: string; directLink: { id: string } | null; recipients: Array<{ id: string }>; fields: Array<{ id: string; recipientId: string }> } | null>;
declare function getClaimsByTeamId(opts: { teamId: string }): Promise<{ flags: { embedSigning: boolean } }>;
declare namespace Route { interface LoaderArgs { params: { token: string }; request: Request } }
declare function superLoaderJson<T>(data: T): T;

async function handleV1Loader({ params }: Route.LoaderArgs) {
  if (!params.token) {
    throw new Response('Not found', { status: 404 });
  }

  const token = params.token;

  const template = await getTemplateByToken({ token }).catch(() => null);

  if (!template || !template.directLink) {
    throw new Response('Not found', { status: 404 });
  }

  const claims = await getClaimsByTeamId({ teamId: template.teamId });
  const allowWhiteLabel = claims.flags.embedSigning;

  return superLoaderJson({
    token,
    template,
    allowWhiteLabel,
  });
}



declare function getEnvelopeForToken(opts: { token: string; userId?: string }): Promise<{ envelopeId: string; recipients: Array<{ id: string }> }>;
declare function getOptionalSession2(request: Request): Promise<{ user: { id: string } | null }>;
declare namespace Route2 { interface LoaderArgs { params: { token: string }; request: Request } }
declare function superLoaderJson2<T>(data: T): T;

async function handleV2Loader({ params, request }: Route2.LoaderArgs) {
  if (!params.token) {
    throw new Response('Not found', { status: 404 });
  }

  const token = params.token;
  const { user } = await getOptionalSession2(request);

  const envelopeData = await getEnvelopeForToken({
    token,
    userId: user?.id,
  }).catch(() => null);

  if (!envelopeData) {
    throw new Response('Not found', { status: 404 });
  }

  return superLoaderJson2({
    token,
    envelopeId: envelopeData.envelopeId,
    recipients: envelopeData.recipients,
  });
}

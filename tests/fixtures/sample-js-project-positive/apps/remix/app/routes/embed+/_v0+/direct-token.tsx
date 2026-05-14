
declare function getSessionFromRequest(req: unknown): Promise<{ user: { id: number; email: string } | null }>;
declare function getTemplateByToken(opts: { token: string }): Promise<{ id: number; teamId: number; directLink: { recipientId: number } | null; recipients: { id: number; email: string }[]; fields: { id: number; recipientId: number }[] } | null>;
declare function getOrgClaimByTeamId(opts: { teamId: number }): Promise<{ flags: { embedWhiteLabel: boolean; hidePowered: boolean } }>;
declare function getOptionalSession(req: unknown): Promise<{ user: { id: number } | null }>;
declare const data: (payload: unknown) => unknown;
declare const superLoaderJson: (payload: unknown) => unknown;
declare function useSuperLoaderData<T>(): T;
declare const EmbedDirectSignClientPage: React.FC<{ token: string; template: unknown; recipient: unknown; fields: unknown[]; hidePoweredBy: boolean }>;
declare const React: { FC: unknown };

async function handleDirectLoader({ params, request }: { params: { token?: string }; request: Request }) {
  if (!params.token) {
    throw new Response('Not found', { status: 404 });
  }

  const token = params.token;

  const template = await getTemplateByToken({ token }).catch(() => null);

  if (!template || !template.directLink) {
    throw new Response('Not found', { status: 404 });
  }

  const orgClaim = await getOrgClaimByTeamId({ teamId: template.teamId });
  const hidePoweredBy = orgClaim.flags.hidePowered;
  const allowWhiteLabel = orgClaim.flags.embedWhiteLabel;

  const directTemplateRecipientId = template.directLink.recipientId;

  const { user } = await getOptionalSession(request);

  const recipient = template.recipients.find((r) => r.id === directTemplateRecipientId);

  if (!recipient) {
    throw new Response('Not found', { status: 404 });
  }

  const fields = template.fields.filter((f) => f.recipientId === directTemplateRecipientId);

  return superLoaderJson({
    token,
    user,
    template,
    recipient,
    fields,
    hidePoweredBy,
    allowWhiteLabel,
  });
}

export async function directTokenLoader({ params, request }: { params: { token?: string }; request: Request }) {
  return handleDirectLoader({ params, request });
}

export default function DirectTokenPage() {
  const { token, template, recipient, fields, hidePoweredBy } = useSuperLoaderData<{
    token: string;
    template: unknown;
    recipient: unknown;
    fields: unknown[];
    hidePoweredBy: boolean;
  }>();

  return (
    <EmbedDirectSignClientPage
      token={token}
      template={template}
      recipient={recipient}
      fields={fields}
      hidePoweredBy={hidePoweredBy}
    />
  );
}



declare function getEnvelopeForDirectSigning(opts: { token: string; userId?: number }): Promise<{ envelope: unknown; recipient: unknown; fields: unknown[] }>;
declare const AppError: { parseError: (e: unknown) => { code: string } };
declare function getOptionalSessionV2(req: Request): Promise<{ user: { id: number } | null }>;
declare const EmbedSignDocumentV2ClientPage: React.FC<{ token: string; envelopeForSigning: unknown; hidePoweredBy: boolean }>;
declare const superLoaderJsonV2: (payload: unknown) => unknown;
declare function useSuperLoaderDataV2<T>(): T;

async function handleV2DirectLoader({ params, request }: { params: { token?: string }; request: Request }) {
  if (!params.token) {
    throw new Response('Not found', { status: 404 });
  }

  const token = params.token;

  const { user } = await getOptionalSessionV2(request);

  const envelopeForSigning = await getEnvelopeForDirectSigning({
    token,
    userId: user?.id,
  })
    .then((result) => ({
      isAccessValid: true,
      ...result,
    } as const))
    .catch(async (e) => {
      const error = AppError.parseError(e);
      return {
        isAccessValid: false,
        error,
        envelope: null,
        recipient: null,
        fields: [],
      } as const;
    });

  return superLoaderJsonV2({
    token,
    envelopeForSigning,
  });
}

export async function directV2Loader({ params, request }: { params: { token?: string }; request: Request }) {
  return handleV2DirectLoader({ params, request });
}

export function DirectV2TokenPage() {
  const { token, envelopeForSigning } = useSuperLoaderDataV2<{
    token: string;
    envelopeForSigning: unknown;
  }>();

  return (
    <EmbedSignDocumentV2ClientPage
      token={token}
      envelopeForSigning={envelopeForSigning}
      hidePoweredBy={false}
    />
  );
}

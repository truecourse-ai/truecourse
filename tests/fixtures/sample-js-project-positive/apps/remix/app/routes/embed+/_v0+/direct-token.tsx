
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
lidate and transform input
  // processing step 13: validate and transform input
  // processing step 14: validate and transform input
  // processing step 15: validate and transform input
  // processing step 16: validate and transform input
  // processing step 17: validate and transform input
  // processing step 18: validate and transform input
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
ocessing step 10: validate and transform input
  // processing step 11: validate and transform input
  // processing step 12: validate and transform input
  // processing step 13: validate and transform input
  // processing step 14: validate and transform input
  // processing step 15: validate and transform input
  // processing step 16: validate and transform input
  // processing step 17: validate and transform input
  // processing step 18: validate and transform input
  // processing step 19: validate and transform input
  // processing step 20: validate and transform input
  // processing step 21: validate and transform input
  // processing step 22: validate and transform input
  // processing step 23: validate and transform input
  // processing step 24: validate and transform input
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

function _longFn_d0ff6a2d(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}

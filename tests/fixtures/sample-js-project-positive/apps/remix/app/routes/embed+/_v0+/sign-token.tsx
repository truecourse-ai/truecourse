
declare function getDocumentAndSenderForEmbed(opts: { token: string; userId?: number; requireAccessAuth: boolean }): Promise<unknown>;
declare function getFieldsForEmbedToken(opts: { token: string }): Promise<unknown[]>;
declare function getRecipientForEmbedToken(opts: { token: string }): Promise<unknown>;
declare function getCompletedFieldsForEmbedToken(opts: { token: string }): Promise<unknown[]>;
declare function getOptionalEmbedSession(req: Request): Promise<{ user: { id: number } | null }>;
declare const EmbedSignDocumentV1Page: React.FC<{ token: string; document: unknown; fields: unknown[]; recipient: unknown; completedFields: unknown[]; hidePoweredBy: boolean }>;
declare const superLoaderJsonEmbed: (payload: unknown) => unknown;
declare function useSuperLoaderDataEmbed<T>(): T;
declare const React: { FC: unknown; ReactNode: unknown };

async function handleEmbedSignLoader({ params, request }: { params: { token?: string }; request: Request }) {
  if (!params.token) {
    throw new Response('Not found', { status: 404 });
  }

  const token = params.token;

  const { user } = await getOptionalEmbedSession(request);

  const [document, fields, recipient, completedFields] = await Promise.all([
    getDocumentAndSenderForEmbed({
      token,
      userId: user?.id,
      requireAccessAuth: false,
    }).catch(() => null),
    getFieldsForEmbedToken({ token }),
    getRecipientForEmbedToken({ token }).catch(() => null),
    getCompletedFieldsForEmbedToken({ token }).catch(() => []),
  ]);

  if (!document || !recipient) {
    throw new Response('Not found', { status: 404 });
  }

  return superLoaderJsonEmbed({
    token,
    user,
    document,
    fields,
    recipient,
    completedFields,
    hidePoweredBy: false,
  });
}

export async function embedSignLoader({ params, request }: { params: { token?: string }; request: Request }) {
  return handleEmbedSignLoader({ params, request });
}

export function EmbedSignPage() {
  const { token, document, fields, recipient, completedFields } = useSuperLoaderDataEmbed<{
    token: string;
    document: unknown;
    fields: unknown[];
    recipient: unknown;
    completedFields: unknown[];
  }>();

  return (
    <EmbedSignDocumentV1Page
      token={token}
      document={document}
      fields={fields}
      recipient={recipient}
      completedFields={completedFields}
      hidePoweredBy={false}
    />
  );
}



declare function getEnvelopeForEmbedSigning(opts: { token: string; userId?: number }): Promise<{ envelope: unknown; recipient: unknown; fields: unknown[] }>;
declare function getOptionalEmbedSessionV2(req: Request): Promise<{ user: { id: number } | null }>;
declare const AppErrorV2: { parseError: (e: unknown) => { code: string; message: string } };
declare const EmbedSignDocumentV2: React.FC<{ token: string; envelopeData: unknown; hidePoweredBy: boolean }>;
declare const superLoaderJsonEmbedV2: (payload: unknown) => unknown;
declare function useSuperLoaderDataEmbedV2<T>(): T;
declare const React: { FC: unknown };

async function handleEmbedSignV2Loader({ params, request }: { params: { token?: string }; request: Request }) {
  if (!params.token) {
    throw new Response('Not found', { status: 404 });
  }

  const token = params.token;

  const { user } = await getOptionalEmbedSessionV2(request);

  const envelopeData = await getEnvelopeForEmbedSigning({
    token,
    userId: user?.id,
  })
    .then((result) => ({
      isDocumentAccessValid: true,
      ...result,
    } as const))
    .catch(async (e) => {
      const error = AppErrorV2.parseError(e);
      return {
        isDocumentAccessValid: false,
        error,
        envelope: null,
        recipient: null,
        fields: [],
      } as const;
    });

  return superLoaderJsonEmbedV2({
    token,
    envelopeData,
  });
}

export async function embedSignV2Loader({ params, request }: { params: { token?: string }; request: Request }) {
  return handleEmbedSignV2Loader({ params, request });
}

export function EmbedSignV2Page() {
  const { token, envelopeData } = useSuperLoaderDataEmbedV2<{ token: string; envelopeData: unknown }>();

  return (
    <EmbedSignDocumentV2
      token={token}
      envelopeData={envelopeData}
      hidePoweredBy={false}
    />
  );
}


declare function getDocumentByToken(opts: { token: string; userId?: string }): Promise<{ id: string; status: string; documentData: unknown } | null>;
declare function getRecipientByToken(opts: { token: string }): Promise<{ id: string; signingStatus: string } | null>;
declare function getFieldsForToken(opts: { token: string }): Promise<{ id: string }[]>;
declare function getCompletedFieldsForToken(opts: { token: string }): Promise<{ id: string }[]>;
declare class Response { constructor(body: string, init: { status: number }): Response }

export async function loader({ params, request }: { params: { token: string }; request: Request }) {
  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const [document, recipient, fields, completedFields] = await Promise.all([
    getDocumentByToken({ token }).catch(() => null),
    getRecipientByToken({ token }).catch(() => null),
    getFieldsForToken({ token }),
    getCompletedFieldsForToken({ token }),
  ]);

  if (!document || !recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  return { document, recipient, fields, completedFields };
}



declare function fetchContractByToken(opts: { token: string; userId?: string }): Promise<{ id: string; status: string } | null>;
declare function fetchSignerByToken(opts: { token: string }): Promise<{ id: string; role: string } | null>;
declare function fetchSignatureFields(opts: { token: string }): Promise<{ id: string }[]>;
declare function getSessionUser(request: Request): Promise<{ id: string } | null>;

const handleContractLoader = async ({ params, request }: { params: { token: string }; request: Request }) => {
  const { token } = params;
  const user = await getSessionUser(request).catch(() => null);

  const [contract, signer, fields] = await Promise.all([
    fetchContractByToken({ token, userId: user?.id }).catch(() => null),
    fetchSignerByToken({ token }).catch(() => null),
    fetchSignatureFields({ token }),
  ]);

  if (!contract || !signer) {
    throw new Response('Not Found', { status: 404 });
  }

  return { contract, signer, fields };
};

export async function loader(args: { params: { token: string }; request: Request }) {
  return handleContractLoader(args);
}



declare function getTeamInsights(opts: { teamId: string; page: number; perPage: number; dateRange: string }): Promise<{ items: unknown[]; total: number }>;
declare function getTeamById(opts: { teamId: string }): Promise<{ id: string; name: string }>;

export async function teamInsightsLoader({ params, request }: { params: { id: string }; request: Request }) {
  const { id } = params;
  const url = new URL(request.url);

  const page = Number(url.searchParams.get('page')) || 1;
  const perPage = Number(url.searchParams.get('perPage')) || 10;
  const dateRange = url.searchParams.get('dateRange') || 'last30days';

  const [insights, team] = await Promise.all([
    getTeamInsights({ teamId: id, page, perPage, dateRange }),
    getTeamById({ teamId: id }),
  ]);

  return {
    teamId: id,
    teamName: team.name,
    insights,
    page,
    perPage,
    dateRange,
  };
}



declare function getRejectedDocumentByToken(opts: { token: string }): Promise<{ id: string; title: string } | null>;
declare function getRejectingRecipientByToken(opts: { token: string }): Promise<{ id: string; name: string; reason: string } | null>;
declare function getDocumentOwnerByToken(opts: { token: string }): Promise<{ id: string; email: string } | null>;

export async function rejectedSigningLoader({ params }: { params: { token: string } }) {
  const { token } = params;

  const [document, recipient, owner] = await Promise.all([
    getRejectedDocumentByToken({ token }).catch(() => null),
    getRejectingRecipientByToken({ token }).catch(() => null),
    getDocumentOwnerByToken({ token }).catch(() => null),
  ]);

  if (!document) {
    throw new Response('Not Found', { status: 404 });
  }

  return { document, recipient, owner };
}



declare function getMultiSignDocuments(opts: { sessionToken: string }): Promise<{ id: string; title: string }[]>;
declare function getMultiSignSession(opts: { sessionToken: string }): Promise<{ id: string; expiresAt: Date } | null>;
declare function getMultiSignParticipant(opts: { sessionToken: string }): Promise<{ id: string; email: string } | null>;

export async function multiSignLoader({ params }: { params: { sessionToken: string } }) {
  const { sessionToken } = params;

  const [session, participant, documents] = await Promise.all([
    getMultiSignSession({ sessionToken }),
    getMultiSignParticipant({ sessionToken }),
    getMultiSignDocuments({ sessionToken }),
  ]);

  if (!session || !participant) {
    throw new Response('Session not found', { status: 404 });
  }

  return { session, participant, documents };
}

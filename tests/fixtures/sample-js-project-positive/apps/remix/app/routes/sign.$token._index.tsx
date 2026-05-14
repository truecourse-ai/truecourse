// remix-route-module: Remix route with loader + React page — framework-managed, no process-level responsibility
declare function getDocumentByToken(token: string): Promise<{ id: string; title: string; status: string } | null>;
declare function redirect(url: string): never;

export async function loader({ params }: { params: { token: string } }) {
  const document = await getDocumentByToken(params.token);
  if (!document) {
    throw redirect('/');
  }
  return { document };
}

export default function SigningPage({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { document } = loaderData;
  return <div>Sign: {document.title}</div>;
}


// Shape: function call with optional number (recipientId?: number) — number|undefined is valid
declare function getEnvelopeForRecipientSigning(
  opts: { token: string; recipientId?: number },
): Promise<{ id: string; title: string; status: string }>;

declare const currentUser: { id?: number } | null;

export async function loadEnvelopeForCurrentUser(
  token: string,
  currentUser: { id?: number } | null,
) {
  const envelope = await getEnvelopeForRecipientSigning({
    token,
    recipientId: currentUser?.id,
  });
  return envelope;
}



// FP: getRecipientEnvelope expects userId: number but receives number | undefined from optional user
declare function getRecipientEnvelope(opts: { token: string; userId: number }): Promise<{ id: string; title: string }>;
declare const signingUser: { id?: number } | null;

export async function loadRecipientEnvelope(token: string) {
  return getRecipientEnvelope({ token, userId: signingUser?.id });
}


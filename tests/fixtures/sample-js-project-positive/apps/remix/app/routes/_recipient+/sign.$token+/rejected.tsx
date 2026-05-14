// loader + RejectedContractPage — react-tsx FP shape (loader + default export component)
declare const getOptionalSessionUser_rej: (request: Request) => Promise<{ user?: { id: number; email: string } }>;
declare const useOptionalAuthSession_rej: () => { sessionData: { user: { id: number; email: string } } | null };
declare const getContractByToken_rej: (opts: { token: string; requireAccessAuth: boolean }) => Promise<{ id: number; title: string; authOptions: unknown } | null>;
declare const isRecipientAuthorised_rej: (opts: { type: string; documentAuthOptions: unknown; recipient: unknown; userId?: number }) => Promise<boolean>;
declare const getFieldsForToken_rej: (opts: { token: string }) => Promise<Array<{ id: number; type: string; customText: string }>>;
declare const getRecipientByToken_rej: (opts: { token: string }) => Promise<{ id: number; name: string; email: string; token: string } | null>;
declare const truncateTitle_rej: (title: string) => string;
declare const FieldType_rej: { NAME: string };

type RejectedLoaderArgs = { params: { token?: string }; request: Request };

export async function loader_rejectedContractPage({ params, request }: RejectedLoaderArgs) {
  const { user } = await getOptionalSessionUser_rej(request);
  const { token } = params;

  if (!token) throw new Response('Not Found', { status: 404 });

  const contract = await getContractByToken_rej({ token, requireAccessAuth: false }).catch(() => null);
  if (!contract) throw new Response('Not Found', { status: 404 });

  const truncatedTitle = truncateTitle_rej(contract.title);

  const [fields, recipient] = await Promise.all([
    getFieldsForToken_rej({ token }),
    getRecipientByToken_rej({ token }).catch(() => null),
  ]);

  if (!recipient) throw new Response('Not Found', { status: 404 });

  const isAccessValid = await isRecipientAuthorised_rej({
    type: 'ACCESS',
    documentAuthOptions: contract.authOptions,
    recipient,
    userId: user?.id,
  });

  const recipientReference =
    recipient.name ||
    fields.find((f) => f.type === FieldType_rej.NAME)?.customText ||
    recipient.email;

  if (isAccessValid) {
    return { isAccessValid: true, recipientReference, truncatedTitle };
  }

  return { isAccessValid: false, recipientReference };
}

type RejectedPageProps = { loaderData: Awaited<ReturnType<typeof loader_rejectedContractPage>> };

export default function RejectedContractPage({ loaderData }: RejectedPageProps) {
  const { sessionData } = useOptionalAuthSession_rej();
  const user = sessionData?.user;

  const { isAccessValid, recipientReference, truncatedTitle } = loaderData as {
    isAccessValid: boolean;
    recipientReference: string;
    truncatedTitle?: string;
  };

  if (!isAccessValid) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Please verify your identity to view this page.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <span aria-hidden>✕</span>
        </span>

        <div>
          <h1 className="text-2xl font-bold">{truncatedTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {recipientReference} declined to sign this contract.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {user ? (
            <a
              href="/contracts"
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Go to contracts
            </a>
          ) : (
            <a
              href="/"
              className="rounded border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Return home
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

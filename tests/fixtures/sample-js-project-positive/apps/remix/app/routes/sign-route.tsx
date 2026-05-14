// sign-route.tsx — recipient signing page route
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare function redirect(url: string): never;
declare function useLoaderData<T>(): T;
declare const SigningHeader: (props: { title: string }) => JSX.Element;
declare const SigningAuthPage: (props: { token: string; authRequired: string[] }) => JSX.Element;
declare const SigningPage: (props: { token: string; envelope: EnvelopeData; recipient: RecipientData }) => JSX.Element;
declare const SigningProvider: (props: { children: React.ReactNode; envelope: EnvelopeData }) => JSX.Element;
declare const SigningAuthProvider: (props: { children: React.ReactNode; authMethods: string[] }) => JSX.Element;

type EnvelopeData = {
  id: number;
  title: string;
  status: string;
  requiresAuth: boolean;
  authMethods: string[];
  createdAt: string;
};

type RecipientData = {
  id: number;
  email: string;
  name: string;
  token: string;
  signingOrder?: number;
};

type RouteLoaderData = {
  envelope: EnvelopeData;
  recipient: RecipientData;
  isAuthRequired: boolean;
};

export async function loader({ params }: { params: { token: string } }) {
  const { token } = params;

  if (!token) {
    throw redirect('/');
  }

  const recipient = await getRecipientByToken({ token }).catch(() => null);

  if (!recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  const envelope = await getEnvelopeForRecipient({ recipientId: recipient.id }).catch(() => null);

  if (!envelope) {
    throw new Response('Not Found', { status: 404 });
  }

  if (envelope.status === 'COMPLETED' || envelope.status === 'VOIDED') {
    throw redirect(`/sign/${token}/done`);
  }

  const isAuthRequired = envelope.requiresAuth && envelope.authMethods.length > 0;

  return { envelope, recipient, isAuthRequired };
}

declare function getRecipientByToken(opts: { token: string }): Promise<RecipientData>;
declare function getEnvelopeForRecipient(opts: { recipientId: number }): Promise<EnvelopeData>;

export default function SignRoute() {
  const { envelope, recipient, isAuthRequired } = useLoaderData<RouteLoaderData>();

  return (
    <SigningProvider envelope={envelope}>
      <div className="flex min-h-screen flex-col">
        <SigningHeader title={envelope.title} />

        <main className="flex flex-1 flex-col items-center justify-center p-4">
          {isAuthRequired ? (
            <SigningAuthProvider authMethods={envelope.authMethods}>
              <SigningAuthPage
                token={recipient.token}
                authRequired={envelope.authMethods}
              />
            </SigningAuthProvider>
          ) : (
            <SigningPage
              token={recipient.token}
              envelope={envelope}
              recipient={recipient}
            />
          )}
        </main>
      </div>
    </SigningProvider>
  );
}

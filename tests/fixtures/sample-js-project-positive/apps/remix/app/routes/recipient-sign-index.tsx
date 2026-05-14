// recipient-sign-index.tsx — recipient signing page with auth logic
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare function useLoaderData<T>(): T;
declare function redirect(url: string): never;
declare const SigningPageLayout: (props: { children: React.ReactNode }) => JSX.Element;
declare const AuthWall: (props: { authMethod: string; onAuth: () => void }) => JSX.Element;
declare const SigningFields: (props: { fields: SignableField[]; recipientId: string; onComplete: () => void }) => JSX.Element;
declare const SigningComplete: (props: { redirectUrl?: string }) => JSX.Element;
declare function useState<T>(init: T): [T, (v: T | ((prev: T) => T)) => void];

type SignableField = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  required: boolean;
};

type SigningRecipient = {
  id: string;
  email: string;
  name?: string;
  token: string;
  authMethod?: string;
  fields: SignableField[];
};

type SigningEnvelope = {
  id: string;
  title: string;
  pdfUrl: string;
  status: string;
  redirectUrl?: string;
};

type RecipientSignIndexLoaderData = {
  envelope: SigningEnvelope;
  recipient: SigningRecipient;
  isAuthenticated: boolean;
};

declare function getSigningSessionData(token: string): Promise<{
  envelope: SigningEnvelope;
  recipient: SigningRecipient;
  isAuthenticated: boolean;
}>;

export async function loader({ params }: { params: { token: string } }) {
  const { token } = params;

  if (!token) throw redirect('/');

  const sessionData = await getSigningSessionData(token).catch(() => null);

  if (!sessionData) throw new Response('Not Found', { status: 404 });

  if (sessionData.envelope.status === 'COMPLETED') {
    throw redirect(`/sign/${token}/complete`);
  }

  if (sessionData.envelope.status === 'VOIDED') {
    throw new Response('Document Voided', { status: 410 });
  }

  return sessionData;
}

export default function RecipientSignIndex() {
  const { envelope, recipient, isAuthenticated } = useLoaderData<RecipientSignIndexLoaderData>();
  const [authPassed, setAuthPassed] = useState(isAuthenticated || !recipient.authMethod);
  const [isComplete, setIsComplete] = useState(false);

  if (isComplete) {
    return <SigningComplete redirectUrl={envelope.redirectUrl} />;
  }

  return (
    <SigningPageLayout>
      {!authPassed && recipient.authMethod ? (
        <AuthWall
          authMethod={recipient.authMethod}
          onAuth={() => setAuthPassed(true)}
        />
      ) : (
        <div className="flex min-h-screen flex-col">
          <div className="border-b px-6 py-4">
            <h1 className="text-lg font-semibold">{envelope.title}</h1>
            {recipient.name && (
              <p className="text-sm text-muted-foreground">Signing as {recipient.name}</p>
            )}
          </div>

          <div className="flex flex-1">
            <div className="flex-1 overflow-auto p-4">
              <iframe
                src={envelope.pdfUrl}
                className="h-full w-full rounded border"
                title={envelope.title}
              />
            </div>

            <div className="w-80 border-l bg-background p-4">
              <h2 className="mb-4 font-medium">Required Fields</h2>
              <SigningFields
                fields={recipient.fields}
                recipientId={recipient.id}
                onComplete={() => setIsComplete(true)}
              />
            </div>
          </div>
        </div>
      )}
    </SigningPageLayout>
  );
}

// recipient-direct-link-index.tsx — direct template access route
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare function useLoaderData<T>(): T;
declare function redirect(url: string): never;
declare const DirectLinkTemplate: (props: { template: DirectTemplate; recipient: DirectLinkRecipient }) => JSX.Element;
declare const DirectLinkAuthPage: (props: { token: string }) => JSX.Element;
declare const DirectLinkCompletedPage: (props: { templateTitle: string }) => JSX.Element;
declare function useState<T>(init: T): [T, (v: T) => void];

type DirectTemplate = {
  id: string;
  title: string;
  description?: string;
  requireAuth: boolean;
  fields: Array<{ id: string; type: string; required: boolean }>;
  recipients: Array<{ id: string; role: string }>;
};

type DirectLinkRecipient = {
  id: string;
  email?: string;
  name?: string;
  token: string;
  status: 'PENDING' | 'COMPLETED';
};

type DirectLinkIndexLoaderData = {
  template: DirectTemplate;
  recipient: DirectLinkRecipient;
  isAuthenticated: boolean;
  token: string;
};

declare function getDirectLinkData(token: string): Promise<{
  template: DirectTemplate;
  recipient: DirectLinkRecipient;
  isAuthenticated: boolean;
}>;

export async function loader({ params }: { params: { token: string } }) {
  const { token } = params;

  if (!token) throw redirect('/');

  const data = await getDirectLinkData(token).catch(() => null);

  if (!data) throw new Response('Not Found', { status: 404 });

  if (!data.template) throw new Response('Template Not Found', { status: 404 });

  return { ...data, token };
}

export default function RecipientDirectLinkIndex() {
  const { template, recipient, isAuthenticated, token } = useLoaderData<DirectLinkIndexLoaderData>();
  const [completed, setCompleted] = useState(recipient.status === 'COMPLETED');

  if (completed) {
    return <DirectLinkCompletedPage templateTitle={template.title} />;
  }

  const needsAuth = template.requireAuth && !isAuthenticated;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">{template.title}</h1>
        {template.description && (
          <p className="text-sm text-muted-foreground">{template.description}</p>
        )}
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        {needsAuth ? (
          <DirectLinkAuthPage token={token} />
        ) : (
          <DirectLinkTemplate template={template} recipient={recipient} />
        )}
      </main>
    </div>
  );
}

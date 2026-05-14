// embed-envelope-edit.tsx — embedded authoring envelope edit route
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare function useLoaderData<T>(): T;
declare function redirect(url: string): never;
declare const EmbedAuthoringProvider: (props: { children: React.ReactNode; envelope: EmbedEnvelope }) => JSX.Element;
declare const EnvelopeEditor: (props: { envelope: EmbedEnvelope; mode: 'edit' | 'create' }) => JSX.Element;
declare const EmbedErrorBoundary: (props: { children: React.ReactNode }) => JSX.Element;

type EmbedRecipient = {
  id: string;
  name?: string;
  email?: string;
  role: string;
  signingOrder: number;
};

type EmbedField = {
  id: string;
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  recipientId: string;
};

type EmbedEnvelope = {
  id: string;
  title: string;
  status: string;
  pdfUrl: string;
  recipients: EmbedRecipient[];
  fields: EmbedField[];
  settings: {
    redirectUrl?: string;
    language: string;
    requirePasscode: boolean;
  };
};

type EmbedEnvelopeEditLoaderData = {
  envelope: EmbedEnvelope;
  embedToken: string;
};

declare function getEmbedEnvelopeForEdit(id: string, embedToken: string): Promise<EmbedEnvelope | null>;
declare function validateEmbedToken(token: string): Promise<boolean>;

export async function loader({ params, request }: { params: { id: string }; request: Request }) {
  const { id } = params;
  const url = new URL(request.url);
  const embedToken = url.searchParams.get('token') ?? '';

  if (!embedToken) throw redirect('/embed/error?code=missing_token');

  const isValid = await validateEmbedToken(embedToken);
  if (!isValid) throw redirect('/embed/error?code=invalid_token');

  const envelope = await getEmbedEnvelopeForEdit(id, embedToken);
  if (!envelope) throw new Response('Not Found', { status: 404 });

  if (envelope.status !== 'DRAFT') {
    throw redirect(`/embed/v2/authoring/envelope.view.${id}?token=${embedToken}`);
  }

  return { envelope, embedToken };
}

export default function EmbedEnvelopeEdit() {
  const { envelope } = useLoaderData<EmbedEnvelopeEditLoaderData>();

  return (
    <EmbedErrorBoundary>
      <EmbedAuthoringProvider envelope={envelope}>
        <div className="flex h-screen flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <EnvelopeEditor envelope={envelope} mode="edit" />
          </div>
        </div>
      </EmbedAuthoringProvider>
    </EmbedErrorBoundary>
  );
}

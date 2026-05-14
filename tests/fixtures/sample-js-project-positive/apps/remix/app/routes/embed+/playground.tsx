interface EmbedPlaygroundParams {
  token: string;
  externalId: string;
  mode: string;
  envelopeId: string;
  folderId: string;
  language: string;
}

export function buildEmbedUrl(params: EmbedPlaygroundParams): string {
  const newParams = new URLSearchParams();

  if (params.token) {
    newParams.set('token', params.token);
  }

  if (params.externalId) {
    newParams.set('externalId', params.externalId);
  }

  if (params.mode && params.mode !== 'create') {
    newParams.set('mode', params.mode);
  }

  if (params.envelopeId) {
    newParams.set('envelopeId', params.envelopeId);
  }

  if (params.folderId) {
    newParams.set('folderId', params.folderId);
  }

  if (params.language) {
    newParams.set('language', params.language);
  }

  return `/embed/sign?${newParams.toString()}`;
}


declare function setMessages(fn: (prev: string[]) => string[]): void;

function handleMessageEvent(event: MessageEvent) {
  const timestamp = new Date().toISOString().slice(11, 19);
  setMessages((prev) => [...prev, `[${timestamp}] ${JSON.stringify(event.data)}`]);
}



declare function useState6<T>(init: T): [T, (v: T) => void];

export default function EmbedPlaygroundPage() {
  const [activeTab, setActiveTab] = useState6<'signing' | 'authoring'>('signing');
  const [tokenInput, setTokenInput] = useState6('');

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b p-4">
        <h1 className="text-xl font-semibold">Embed Playground</h1>
      </header>
      <div className="grid grid-cols-2 gap-6 p-6">
        <aside className="space-y-4">
          <div className="flex gap-2">
            <button
              className={activeTab === 'signing' ? 'btn btn-primary' : 'btn'}
              onClick={() => setActiveTab('signing')}
            >
              Signing
            </button>
            <button
              className={activeTab === 'authoring' ? 'btn btn-primary' : 'btn'}
              onClick={() => setActiveTab('authoring')}
            >
              Authoring
            </button>
          </div>
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste embed token here"
            className="input w-full"
          />
        </aside>
        <main className="rounded-lg border bg-white" />
      </div>
    </div>
  );
}

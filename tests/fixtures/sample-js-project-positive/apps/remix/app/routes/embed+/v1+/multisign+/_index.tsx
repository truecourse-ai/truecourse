
declare const getSessionOpt8: (req: Request) => Promise<{ user: { id: string } | null }>;
declare const getEnvelopesByTokens8: (tokens: string[]) => Promise<Array<{ id: string; title: string; teamId: number }>>;
declare const getRecipientsByTokens8: (tokens: string[]) => Promise<Array<{ id: number; email: string; token: string; signingStatus: string }>>;
declare const getOrgClaims8: (teamId: number) => Promise<{ flags: { multiSignWhiteLabel: boolean; hidePoweredBy: boolean } }>;
declare const superLoaderJson8: <T>(data: T) => T;
declare const useSuperLoaderData8: <T>() => T;
declare const useEffect8: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useLayoutEffect8: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useState8: <T>(init: T) => [T, (v: T) => void];
declare const useRevalidator8: () => { revalidate: () => void };
declare const BrandingLogo8: React.ComponentType<{ className?: string }>;
declare const MultiSignList8: React.ComponentType<{ envelopes: unknown[]; onSelect: (env: unknown) => void }>;
declare const MultiSignSigningView8: React.ComponentType<{ envelope: unknown; recipient: unknown }>;
declare const injectCss8: (vars: Record<string, string>) => void;
declare const ZMultiSignDataSchema8: { parse: (data: unknown) => { accentColor?: string; hidePoweredBy?: boolean } };

type MultiSignLoaderData8 = {
  envelopes: Array<{ envelope: { id: string; title: string; teamId: number }; recipient: { id: number; email: string; token: string; signingStatus: string } }>;
  user: { id: string } | null;
  hidePoweredBy: boolean;
  allowWhiteLabel: boolean;
};

export async function multiSignLoader8({ request }: { request: Request }): Promise<MultiSignLoaderData8> {
  const { user } = await getSessionOpt8(request);

  const url = new URL(request.url);
  const tokens = url.searchParams.getAll('token');

  const [envelopes, recipients] = await Promise.all([
    getEnvelopesByTokens8(tokens),
    getRecipientsByTokens8(tokens),
  ]);

  const pairs = tokens.map((token, idx) => ({
    envelope: envelopes[idx],
    recipient: recipients[idx],
  })).filter((p) => p.envelope && p.recipient);

  const firstEnvelope = envelopes[0];

  if (!firstEnvelope) {
    return superLoaderJson8({ envelopes: pairs, user, hidePoweredBy: false, allowWhiteLabel: false });
  }

  const orgClaims = await getOrgClaims8(firstEnvelope.teamId);

  return superLoaderJson8({
    envelopes: pairs,
    user,
    hidePoweredBy: orgClaims.flags.hidePoweredBy,
    allowWhiteLabel: orgClaims.flags.multiSignWhiteLabel,
  });
}

export function MultiSignEmbedPage8() {
  const { envelopes, hidePoweredBy } = useSuperLoaderData8<MultiSignLoaderData8>();

  const [selectedEnvelope, setSelectedEnvelope] = useState8<MultiSignLoaderData8['envelopes'][number] | null>(null);
  const { revalidate } = useRevalidator8();

  useLayoutEffect8(() => {
    injectCss8({});
  }, []);

  useEffect8(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'MULTI_SIGN_REFRESH') {
        revalidate();
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [revalidate]);

  if (selectedEnvelope) {
    return <MultiSignSigningView8 envelope={selectedEnvelope.envelope} recipient={selectedEnvelope.recipient} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      {!hidePoweredBy && <BrandingLogo8 className="mx-auto mt-8 h-6" />}

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <MultiSignList8 envelopes={envelopes} onSelect={setSelectedEnvelope} />
      </main>
    </div>
  );
}



// [unknown-catch-variable] catch(err) — only console.error(err); no further property access
declare function initializeMultiSignSession(token: string): Promise<{ sessionId: string; recipients: string[] }>;
declare let sessionData: { sessionId: string; recipients: string[] } | null;
declare const sessionToken: string;

async function bootstrapMultiSignFlow(): Promise<void> {
  try {
    sessionData = await initializeMultiSignSession(sessionToken);
  } catch (err) {
    console.error(err);
  }
}

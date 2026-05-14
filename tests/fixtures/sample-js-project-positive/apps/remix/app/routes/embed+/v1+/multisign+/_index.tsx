
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
nsform input
  // processing step 22: validate and transform input
  // processing step 23: validate and transform input
  // processing step 24: validate and transform input
  // processing step 25: validate and transform input
  // processing step 26: validate and transform input
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

function _longFn_26cf8991(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}


declare function useLoaderData<T>(): T;
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useLayoutEffect(fn: () => void, deps?: unknown[]): void;

export default function EmbedAuthoringLayout() {
  const { token, hasValidToken } = useLoaderData<{ token: string; hasValidToken: boolean }>();
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    try {
      const hash = window.location.hash.slice(1);
      const config = JSON.parse(decodeURIComponent(atob(hash)));
      if (config.darkMode) {
        document.documentElement.classList.add('dark');
      }
    } catch {
      // ignore parse errors
    }
    setReady(true);
  }, []);

  if (!ready || !hasValidToken) {
    return <div className="flex h-screen items-center justify-center"><span>Loading...</span></div>;
  }

  return (
    <div className="embed-layout" data-token={token}>
      <main className="h-screen w-screen overflow-hidden" />
    </div>
  );
}



declare const useState9: <T>(v: T) => [T, (v: T) => void];
declare const useLayoutEffect2: (fn: () => void | (() => void), deps?: unknown[]) => void;
declare const ZBaseEmbedAuthoringSchema2: { safeParse: (v: unknown) => { success: boolean; data?: { css?: string; cssVars?: Record<string, string>; darkModeDisabled?: boolean; language?: string } } };
declare const dynamicActivate2: (lang: string) => Promise<void>;
declare const APP_I18N_OPTIONS2: { sourceLang: string };
declare const allowEmbedAuthoringWhiteLabel2: boolean;
declare const injectCss2: (opts: { css?: string; cssVars?: Record<string, string> }) => void;
declare const Spinner2: React.FC<{}>;
declare const Outlet2: React.FC<{}>;
declare const TrpcProvider2: React.FC<{ headers: Record<string, string>; children?: React.ReactNode }>;
declare const Trans3: React.FC<{ children?: React.ReactNode }>;
declare const React: { FC: unknown; ReactNode: unknown };

export default function EmbedAuthoringLayout2({ loaderData }: { loaderData: { token: string; hasValidToken: boolean } }) {
  const { token, hasValidToken } = loaderData;

  const [hasFinishedInit, setHasFinishedInit] = useState9(!hasValidToken);

  useLayoutEffect2(() => {
    if (!hasValidToken) {
      return;
    }

    try {
      const hash = window.location.hash.slice(1);

      if (!hash) {
        setHasFinishedInit(true);
        return;
      }

      const result = ZBaseEmbedAuthoringSchema2.safeParse(JSON.parse(decodeURIComponent(atob(hash))));

      if (!result.success) {
        setHasFinishedInit(true);
        return;
      }

      const { css, cssVars, darkModeDisabled, language } = result.data!;

      if (darkModeDisabled) {
        document.documentElement.classList.add('dark-mode-disabled');
      }

      if (allowEmbedAuthoringWhiteLabel2) {
        injectCss2({ css, cssVars });
      }

      if (language && language !== APP_I18N_OPTIONS2.sourceLang) {
        void dynamicActivate2(language).finally(() => {
          setHasFinishedInit(true);
        });
      } else {
        setHasFinishedInit(true);
      }
    } catch (error) {
      console.error(error);
      setHasFinishedInit(true);
    }
  }, []);

  if (!hasFinishedInit) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner2 />
      </div>
    );
  }

  if (!hasValidToken) {
    return (
      <div>
        <Trans3>Invalid embedding presign token provided</Trans3>
      </div>
    );
  }

  return (
    <TrpcProvider2 headers={{ authorization: `Bearer ${token}` }}>
      <Outlet2 />
    </TrpcProvider2>
  );
}

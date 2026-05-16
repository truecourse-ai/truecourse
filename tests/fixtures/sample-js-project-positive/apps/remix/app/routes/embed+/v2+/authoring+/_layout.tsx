
declare function useLoaderDataV2<T>(): T;
declare function useState3<T>(init: T): [T, (v: T) => void];
declare function useLayoutEffect2(fn: () => void | (() => void)): void;

export default function EmbedAuthoringLayoutV2() {
  const { token, allowWhiteLabel } = useLoaderDataV2<{ token: string; allowWhiteLabel: boolean }>();
  const [initialized, setInitialized] = useState3(false);

  useLayoutEffect2(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('dark') === '1') {
        document.documentElement.classList.add('dark');
      }
    } catch {
      // ignore
    }
    setInitialized(true);
  });

  if (!initialized) {
    return <div className="grid h-screen place-items-center"><span>Initializing...</span></div>;
  }

  return (
    <div className="embed-v2-layout" data-token={token} data-white-label={String(allowWhiteLabel)}>
      <main className="h-screen w-screen" />
    </div>
  );
}

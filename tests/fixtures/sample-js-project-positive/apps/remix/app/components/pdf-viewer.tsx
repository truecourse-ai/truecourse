
// --- react-useless-set-state FP: setState called with locally computed variable (not current state) ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare const pdfLib: { loadDocument(url: string): Promise<{ numPages: number; getPage(n: number): Promise<{ getViewport(opts: { scale: number }): { width: number; height: number } }> }> };

function PdfViewer({ url }: { url: string }) {
  const [pages, setPages] = useState<Array<{ width: number; height: number }>>([]);
  const [loadingState, setLoadingState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  useEffect(() => {
    let isCancelled = false;

    const loadDocument = async () => {
      setLoadingState('loading');
      try {
        const doc = await pdfLib.loadDocument(url);
        const pages = await Promise.all(
          Array.from({ length: doc.numPages }, (_, i) =>
            doc.getPage(i + 1).then((page) => {
              const viewport = page.getViewport({ scale: 1 });
              return { width: viewport.width, height: viewport.height };
            }),
          ),
        );

        if (isCancelled) return;
        setPages(pages);
        setLoadingState('loaded');
      } catch (err) {
        if (isCancelled) return;
        setLoadingState('error');
      }
    };

    void loadDocument();
    return () => { isCancelled = true; };
  }, [url]);

  return <div>{pages.length} pages</div>;
}

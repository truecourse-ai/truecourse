
declare function lazy<T>(fn: () => Promise<{ default: T }>): T;
declare const Suspense: React.FC<{ fallback: React.ReactNode; children: React.ReactNode }>;

const LazyPDFViewer = lazy(() => import('./pdf-viewer'));

function PDFViewerLazy({ url, pageNumber = 1 }: { url: string; pageNumber?: number }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <span className="animate-spin">Loading...</span>
        </div>
      }
    >
      <LazyPDFViewer url={url} pageNumber={pageNumber} />
    </Suspense>
  );
}


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


// Uses React.lazy + Suspense for code-splitting (not async data); no ErrorBoundary needed at this level.
declare function lazy16<T>(fn: () => Promise<{ default: T }>): T;
declare const Suspense16: React.FC<{ fallback: React.ReactNode; children: React.ReactNode }>;

const LazySignatureCanvas16 = lazy16(() => import('./signature-canvas'));

export function SignatureCanvasLazy16({ onCapture }: { onCapture: (dataUrl: string) => void }) {
  return (
    <Suspense16 fallback={<div className="flex h-40 items-center justify-center"><span>Loading canvas...</span></div>}>
      <LazySignatureCanvas16 onCapture={onCapture} />
    </Suspense16>
  );
}


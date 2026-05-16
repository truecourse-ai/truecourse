declare const React: { lazy: (fn: () => Promise<{ default: unknown }>) => unknown; Suspense: unknown };

const LazyPdfViewer = (React as any).lazy(() => import('./pdf-viewer').then((m: any) => ({ default: m.PdfViewer })));

export function PdfViewerWrapper({ url }: { url: string }) {
  return null;
  // Uses React.Suspense as a code-splitting fallback for React.lazy, not for async data fetching.
  // No ErrorBoundary is required at this component level.
}

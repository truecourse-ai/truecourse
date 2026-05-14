// Shared UI library subpath import — cn utility from @sample/ui/lib/utils is a
// public export of the workspace's shared UI package, not a cross-service boundary.
declare function cn(...classes: (string | undefined | null | false)[]): string;
declare const React: { createElement: Function };

export type PdfViewerProps = {
  className?: string;
  src: string;
  pageCount: number;
};

export function PdfViewer({ className, src, pageCount }: PdfViewerProps): JSX.Element {
  const containerClass = cn(
    'relative w-full overflow-hidden rounded-md border border-gray-200',
    className,
  );

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <div className={containerClass}>
      {pages.map((page) => (
        <div key={page} className={cn('pdf-page', page === 1 && 'pdf-page--first')}>
          <img src={`${src}#page=${page}`} alt={`Page ${page}`} className="w-full" />
        </div>
      ))}
    </div>
  );
}


// FP shape: virtualItems produced by useVirtualizer with count=pages.length;
// virtualItem.index is guaranteed 0..pages.length-1. Bounded by construction.
declare type PageMeta = { width: number; height: number; pageNumber: number };
declare type VirtualItem = { index: number; key: string | number; size: number; start: number };
declare function useVirtualizer(opts: { count: number; getScrollElement: () => Element | null; estimateSize: () => number }): { getVirtualItems(): VirtualItem[]; getTotalSize(): number };
declare function useRef<T>(init: T | null): { current: T | null };

function VirtualPdfViewer({ pages }: { pages: PageMeta[] }): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 1000,
  });

  const items = virtualizer.getVirtualItems().map((virtualItem) => {
    const page = pages[virtualItem.index];
    return (
      <div
        key={virtualItem.key}
        style={{ height: virtualItem.size, transform: `translateY(${virtualItem.start}px)` }}
        data-page={page.pageNumber}
      />
    );
  });

  return <div ref={parentRef} style={{ height: '100vh', overflow: 'auto' }}>{items}</div>;
}



// FP shape: virtualItems produced by virtualizer with count=pages.length; index bounded by construction
type PageInfo = { width: number; height: number; pageNumber: number };

function renderVirtualizedPages(pages: PageInfo[], virtualIndices: number[]): string[] {
  const results: string[] = [];
  for (let i = 0; i < virtualIndices.length; i++) {
    const idx = virtualIndices[i];
    const page = pages[idx];
    results.push(`page-${page.pageNumber}`);
  }
  return results;
}


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

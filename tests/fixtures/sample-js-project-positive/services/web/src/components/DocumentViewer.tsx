
declare const React: any;
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps?: any[]): void;
declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
declare const cn: (...args: any[]) => string;
declare const ZoomIn: any;
declare const ZoomOut: any;
declare const RotateCw: any;
declare const ChevronLeft: any;
declare const ChevronRight: any;
declare const Download: any;

type DocumentViewerProps = {
  documentUrl: string;
  totalPages: number;
  onPageChange?: (page: number) => void;
  onDownload?: () => void;
  className?: string;
};

export const DocumentViewer = ({
  documentUrl,
  totalPages,
  onPageChange,
  onDownload,
  className,
}: DocumentViewerProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);

  const handlePrevPage = useCallback(() => {
    setCurrentPage((p) => Math.max(1, p - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setCurrentPage((p) => Math.min(totalPages, p + 1));
  }, [totalPages]);

  const handleZoomIn = useCallback(() => {
    setScale((s) => Math.min(3.0, parseFloat((s + 0.25).toFixed(2))));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((s) => Math.max(0.5, parseFloat((s - 0.25).toFixed(2))));
  }, []);

  const handleRotate = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handlePrevPage();
      if (e.key === 'ArrowRight') handleNextPage();
      if (e.key === '+') handleZoomIn();
      if (e.key === '-') handleZoomOut();
    },
    [handlePrevPage, handleNextPage, handleZoomIn, handleZoomOut],
  );

  return (
    <div
      className={cn('flex flex-col h-full w-full bg-muted/20', className)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={scale <= 0.5}
            className="rounded p-1 hover:bg-muted disabled:opacity-40"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>

          <span className="text-sm tabular-nums">{Math.round(scale * 100)}%</span>

          <button
            type="button"
            onClick={handleZoomIn}
            disabled={scale >= 3.0}
            className="rounded p-1 hover:bg-muted disabled:opacity-40"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleRotate}
            className="rounded p-1 hover:bg-muted"
            aria-label="Rotate"
          >
            <RotateCw className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            className="rounded p-1 hover:bg-muted disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="text-sm tabular-nums">
            {currentPage} / {totalPages}
          </span>

          <button
            type="button"
            onClick={handleNextPage}
            disabled={currentPage >= totalPages}
            className="rounded p-1 hover:bg-muted disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-muted"
          >
            <Download className="h-4 w-4" />
            Download
          </button>
        )}
      </div>

      <div className="relative flex-1 overflow-auto">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: 'top center',
          }}
          className="transition-transform"
        >
          <iframe
            src={`${documentUrl}#page=${currentPage}`}
            title="Document viewer"
            className="h-full w-full"
            onLoad={() => setIsLoading(false)}
          />
        </div>
      </div>
    </div>
  );
};

// --- canvas-renderer hook: long useEffect with nested helpers inside a custom React hook (TSX) ---

declare function useState<T>(initial: T): [T, (v: T) => void];
declare function useEffect(fn: () => (() => void) | void, deps: unknown[]): void;
declare function useRef<T>(initial: T): { current: T };
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const Math: { floor: (n: number) => number };
declare const document: { createElement: (tag: string) => HTMLCanvasElement };
declare const console: { error: (...args: unknown[]) => void };
declare const setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
declare const clearTimeout: (id: ReturnType<typeof setTimeout>) => void;

type CanvasLoadingState = 'loading' | 'loaded' | 'error';

interface CanvasPageDoc {
  getPage(n: number): Promise<{
    getViewport(opts: { scale: number }): { width: number; height: number };
    render(opts: { canvasContext: CanvasRenderingContext2D | null; viewport: unknown; canvas: HTMLCanvasElement }): { promise: Promise<void>; cancel(): void };
  }>;
}

interface CanvasPageProps {
  pageNumber: number;
  doc: CanvasPageDoc | null;
  scale: number;
  scaledWidth: number;
  scaledHeight: number;
}

const LOW_CANVAS_RESOLUTION = 1;
const HIGH_CANVAS_RESOLUTION = 2;
const IDLE_RENDER_DELAY_MS = 300;
const CANVAS_PAGE_CLASSNAME = 'canvas-page-image';

/**
 * Manages rendering a single page of a canvas document at two resolutions:
 * a fast low-res pass followed by a high-res pass after an idle delay.
 * Both passes share cancellation and task-tracking logic via refs.
 */
const useCanvasPageImage = ({ pageNumber, doc, scale, scaledWidth, scaledHeight }: CanvasPageProps) => {
  const [canvasLoadingState, setCanvasLoadingState] = useState<CanvasLoadingState>('loading');
  const [imageUrl, setImageUrl] = useState('');

  const renderTaskRef = useRef<{ promise: Promise<void>; cancel(): void } | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const renderedResolutionRef = useRef<number | null>(null);
  const renderedPageNumberRef = useRef<number | null>(null);
  const renderedDocRef = useRef<CanvasPageDoc | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const cancelRenderTask = () => {
      if (!renderTaskRef.current) {
        return;
      }
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    };

    const hasMatchingRenderedImage = (resolution: number) => {
      return (
        renderedDocRef.current === doc &&
        renderedPageNumberRef.current === pageNumber &&
        renderedResolutionRef.current === resolution
      );
    };

    const setRenderedImageMeta = (resolution: number) => {
      renderedDocRef.current = doc;
      renderedPageNumberRef.current = pageNumber;
      renderedResolutionRef.current = resolution;
    };

    const renderAtResolution = async (resolution: number) => {
      let currentTask: { promise: Promise<void>; cancel(): void } | null = null;

      try {
        if (isCancelled) {
          return;
        }

        if (hasMatchingRenderedImage(resolution)) {
          return;
        }

        cancelRenderTask();

        if (!doc) {
          return;
        }

        const page = await doc.getPage(pageNumber);

        if (isCancelled) {
          return;
        }

        const renderScale = scale * resolution;
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('Failed to get canvas rendering context');
        }

        currentTask = page.render({
          canvasContext: context,
          viewport,
          canvas,
        });
        renderTaskRef.current = currentTask;

        await currentTask.promise;

        if (isCancelled || renderTaskRef.current !== currentTask) {
          return;
        }

        setRenderedImageMeta(resolution);
        setImageUrl((canvas as unknown as { toDataURL(fmt: string): string }).toDataURL('image/jpeg'));
      } catch (err) {
        if (err instanceof Error && err.name === 'RenderingCancelledException') {
          return;
        }

        if (!isCancelled) {
          console.error(err);
          setCanvasLoadingState('error');
        }
      } finally {
        if (renderTaskRef.current === currentTask) {
          renderTaskRef.current = null;
        }
      }
    };

    void renderAtResolution(LOW_CANVAS_RESOLUTION);

    idleTimerRef.current = setTimeout(() => {
      void renderAtResolution(HIGH_CANVAS_RESOLUTION);
    }, IDLE_RENDER_DELAY_MS);

    return () => {
      isCancelled = true;

      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }

      cancelRenderTask();
    };
  }, [doc, pageNumber, scale]);

  const imageProps = useMemo(
    () => ({
      className: CANVAS_PAGE_CLASSNAME,
      width: Math.floor(scaledWidth),
      height: Math.floor(scaledHeight),
      alt: '' as const,
      onLoad: () => setCanvasLoadingState('loaded'),
      onError: () => setCanvasLoadingState('error'),
      src: imageUrl,
      'data-page-number': pageNumber,
      draggable: false,
    }),
    [scaledWidth, scaledHeight, imageUrl, pageNumber],
  );

  return {
    imageProps,
    canvasLoadingState,
  };
};



declare const pdfjsLib2: { getDocument: (opts: unknown) => { promise: Promise<unknown> }; RenderTask: unknown };
declare const useState7: <T>(v: T) => [T, (v: T) => void];
declare const useEffect7: (fn: () => (() => void) | void, deps: unknown[]) => void;
declare const useRef7: <T>(v: T | null) => { current: T | null };
declare const React: { FC: unknown; ReactNode: unknown; MutableRefObject: unknown };

type PdfPageThumbnailProps = {
  pdf: unknown;
  pageNumber: number;
  scale?: number;
  className?: string;
};

export const PdfPageThumbnail = ({ pdf, pageNumber, scale = 0.3, className }: PdfPageThumbnailProps) => {
  const canvasRef = useRef7<HTMLCanvasElement>(null);
  const [isRendering, setIsRendering] = useState7(false);
  const [hasError, setHasError] = useState7(false);

  const renderedPdfRef = useRef7<unknown>(null);
  const renderedPageNumberRef = useRef7<number | null>(null);
  const renderedScaleRef = useRef7<number | null>(null);
  const renderTaskRef = useRef7<unknown>(null);

  const cancelRenderTask = () => {
    if (!renderTaskRef.current) return;
    (renderTaskRef.current as { cancel: () => void }).cancel();
    renderTaskRef.current = null;
  };

  const hasMatchingRenderedImage = () =>
    renderedPdfRef.current === pdf &&
    renderedPageNumberRef.current === pageNumber &&
    renderedScaleRef.current === scale;

  useEffect7(() => {
    let isCancelled = false;

    const render = async () => {
      if (!canvasRef.current || !pdf) return;

      if (hasMatchingRenderedImage()) return;

      cancelRenderTask();
      setIsRendering(true);

      try {
        const page = await (pdf as { getPage: (n: number) => Promise<unknown> }).getPage(pageNumber);

        if (isCancelled) return;

        const viewport = (page as { getViewport: (opts: { scale: number }) => { width: number; height: number } }).getViewport({ scale });
        const canvas = canvasRef.current!;
        const context = canvas.getContext('2d')!;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const task = (page as { render: (opts: unknown) => unknown }).render({ canvasContext: context, viewport });
        renderTaskRef.current = task;

        await (task as Promise<void>);

        renderedPdfRef.current = pdf;
        renderedPageNumberRef.current = pageNumber;
        renderedScaleRef.current = scale;
      } catch (e) {
        if (!isCancelled) setHasError(true);
      } finally {
        if (!isCancelled) setIsRendering(false);
      }
    };

    render();

    return () => {
      isCancelled = true;
      cancelRenderTask();
    };
  }, [pdf, pageNumber, scale]);

  if (hasError) {
    return <div className="flex items-center justify-center bg-muted text-xs text-muted-foreground">Error</div>;
  }

  return (
    <div className={className}>
      {isRendering && <div className="animate-pulse bg-muted" />}
      <canvas ref={canvasRef as React.Ref<HTMLCanvasElement>} className="h-full w-full" />
    </div>
  );
};



// FP shape: virtualItems is produced by a virtual list with itemCount=pages.length;
// virtualItem.index is guaranteed 0..pages.length-1. Bounded by construction.
declare type TPageMeta = { width: number; height: number };
declare type TVirtualItem = { index: number; key: string | number; size: number; start: number };
declare function useVirtualList(opts: { itemCount: number; itemSize: number }): { virtualItems: TVirtualItem[] };

function VirtualPageRenderer({ pages, containerWidth }: { pages: TPageMeta[]; containerWidth: number }) {
  const { virtualItems } = useVirtualList({ itemCount: pages.length, itemSize: 800 });

  return virtualItems.map((virtualItem) => {
    const pageMeta = pages[virtualItem.index];
    const scale = containerWidth / pageMeta.width;
    const scaledHeight = Math.floor(pageMeta.height * scale);
    return { key: virtualItem.key, scaledHeight, start: virtualItem.start };
  });
}

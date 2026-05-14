declare const useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
declare const useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
declare const useRef: <T>(initial: T) => { current: T };
declare const useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T;
declare function fetchMediaBlob(url: string): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
declare function decodeFrames(buf: Uint8Array): Promise<{ destroy(): Promise<void>; getFrameCount(): number; getFrame(index: number): Promise<{ width: number; height: number }> }>;
declare function notify(toast: { title: string; description: string; variant: string }): void;
declare function classes(...names: Array<string | undefined>): string;

type FrameMeta = { width: number; height: number };
type MediaLoadState = 'loading' | 'loaded' | 'error';

const LOW_RES = 1;
const HIGH_RES = 2;
const IDLE_DECODE_DELAY = 200;

export type MediaViewerProps = {
  className?: string;
  source: Uint8Array | string | null;
  onMediaReady?: () => void;
  framePainter?: (props: { frameIndex: number; width: number; height: number }) => JSX.Element;
};

export default function MediaViewer({
  className,
  source,
  onMediaReady,
  framePainter,
}: MediaViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const decoderRef = useRef<{ destroy(): Promise<void>; getFrameCount(): number; getFrame(index: number): Promise<FrameMeta> } | null>(null);
  const [loadState, setLoadState] = useState<MediaLoadState>('loading');
  const [frames, setFrames] = useState<FrameMeta[]>([]);

  useEffect(() => {
    if (!source) {
      return;
    }

    let isCancelled = false;

    const loadFrameMetadata = async () => {
      try {
        setLoadState('loading');
        setFrames([]);

        if (isCancelled) {
          return;
        }

        let buffer: Uint8Array | null = typeof source === 'string' ? null : new Uint8Array(source);

        if (typeof source === 'string') {
          const response = await fetchMediaBlob(source);

          if (!response.ok) {
            throw new Error(`Failed to fetch media: ${response.status}`);
          }

          buffer = new Uint8Array(await response.arrayBuffer());
        }

        if (isCancelled) {
          return;
        }

        const decoder = await decodeFrames(buffer!);

        if (isCancelled) {
          await decoder.destroy();
          return;
        }

        if (decoderRef.current) {
          await decoderRef.current.destroy();
        }

        decoderRef.current = decoder;

        const collected: FrameMeta[] = [];
        for (let index = 0; index < decoder.getFrameCount(); index++) {
          const frame = await decoder.getFrame(index);
          collected.push({ width: frame.width, height: frame.height });
        }

        if (isCancelled) {
          return;
        }

        setFrames(collected);
        setLoadState('loaded');
      } catch (err) {
        if (isCancelled) {
          return;
        }

        console.error(err);
        setLoadState('error');

        notify({
          title: 'Error',
          description: 'An error occurred while loading the media stream.',
          variant: 'destructive',
        });
      }
    };

    void loadFrameMetadata();

    return () => {
      isCancelled = true;

      if (decoderRef.current) {
        void decoderRef.current.destroy();
        decoderRef.current = null;
      }
    };
  }, [source]);

  useEffect(() => {
    if (loadState === 'loaded' && onMediaReady) {
      onMediaReady();
    }
  }, [loadState, onMediaReady]);

  const isLoading = loadState === 'loading';
  const hasError = loadState === 'error';

  if (!source) {
    return (
      <div ref={containerRef} className={classes('h-full', 'w-full', className)}>
        <p className="py-32 text-center text-sm">No media found</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={classes('h-full', 'w-full', className)}>
      {isLoading && <span className="block py-16 text-center">Loading media...</span>}
      {hasError && <span className="block py-16 text-center text-red-500">Failed to load</span>}
      {loadState === 'loaded' && frames.length > 0 && (
        <ul className="grid gap-2">
          {frames.map((frame, index) => (
            <li key={index} style={{ width: frame.width, height: frame.height }}>
              {framePainter ? framePainter({ frameIndex: index, width: frame.width, height: frame.height }) : <span>Frame {index + 1}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

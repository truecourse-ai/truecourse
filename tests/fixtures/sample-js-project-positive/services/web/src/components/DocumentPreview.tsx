// DocumentPreview — lazy-loads the heavy PDF renderer and falls back to a
// skeleton while the bundle is fetched or when rendering server-side.

declare function cn(...classes: (string | undefined | null | false)[]): string;
declare const Suspense: { new(props: { fallback: unknown; children?: unknown }): unknown };
declare function lazy<T>(factory: () => Promise<{ default: T }>): T;
declare function useState<T>(initial: T): [T, (v: T) => void];
declare function useEffect(fn: () => void, deps: unknown[]): void;

// Import of a utility from the shared monorepo UI library subpath.
// @sample/ui is a public workspace UI package; lib/utils exposes cn() and
// other class-name helpers that all apps are permitted to consume.
import { cn as classNames } from '@sample/ui/lib/utils';

interface DocumentPreviewProps {
  url: string;
  className?: string;
  title?: string;
}

const HeavyRenderer = lazy(async () => import('./HeavyRenderer'));

export default function DocumentPreview(props: DocumentPreviewProps): JSX.Element {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const placeholder = (
    <div className={classNames('h-full w-full animate-pulse bg-muted', props.className)}>
      <span className="sr-only">Loading document…</span>
    </div>
  );

  if (!ready) {
    return placeholder as unknown as JSX.Element;
  }

  return (
    <Suspense fallback={placeholder}>
      {HeavyRenderer && <HeavyRenderer url={props.url} title={props.title} />}
    </Suspense>
  ) as unknown as JSX.Element;
}

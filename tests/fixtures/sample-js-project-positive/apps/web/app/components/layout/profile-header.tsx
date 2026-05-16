
// scrollY > 5 is a near-zero scroll threshold to show a border on the sticky header
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(cb: () => (() => void) | void, deps: unknown[]): void;
declare const cn: (...args: unknown[]) => string;

function useScrollBorder(): boolean {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return scrollY > 5;
}

const headerClass = cn(
  'sticky top-0 z-50 border-b border-b-transparent bg-background/95 backdrop-blur',
  useScrollBorder() && 'border-b-border',
);

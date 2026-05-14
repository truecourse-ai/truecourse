
// window.innerWidth < 768 is the standard Tailwind md breakpoint for mobile detection
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(cb: () => (() => void) | void, deps: unknown[]): void;

function useMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkIfMobile();

    window.addEventListener('resize', checkIfMobile);

    return () => {
      window.removeEventListener('resize', checkIfMobile);
    };
  }, []);

  return isMobile;
}

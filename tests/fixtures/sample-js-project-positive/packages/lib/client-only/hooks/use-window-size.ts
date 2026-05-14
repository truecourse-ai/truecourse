
declare function useState4<T>(init: T): [T, (v: T) => void];
declare function useEffect4(fn: () => (() => void) | void, deps: unknown[]): void;
declare const window2: { innerWidth: number; innerHeight: number; addEventListener(e: string, fn: () => void): void; removeEventListener(e: string, fn: () => void): void };

function useWindowSize() {
  const [size, setSize] = useState4({ width: 0, height: 0 });

  useEffect4(() => {
    function update() {
      setSize({ width: window2.innerWidth, height: window2.innerHeight });
    }
    update();
    window2.addEventListener('resize', update);
    return () => window2.removeEventListener('resize', update);
  }, []);

  return size;
}

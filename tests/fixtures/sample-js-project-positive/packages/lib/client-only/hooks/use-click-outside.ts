
// FP: event.target as Node — the DOM contains() check requires a Node, and MouseEvent.target
// is typed as EventTarget | null. The assertion is structurally required, not unsafe.
declare function useRef<T>(init: T): { current: T };
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;

function useClickOutside(onClickOutside: () => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        onClickOutside();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [onClickOutside]);

  return { containerRef, triggerRef };
}



// FP: event.target as Node — required for HTMLElement.contains() which needs a Node argument.
// The cast is structurally safe because event.target in a click context is always a Node.
declare function useRef2<T>(init: T): { current: T };
declare function useEffect2(fn: () => void | (() => void), deps: unknown[]): void;

function useOutsideClick(callback: () => void) {
  const panelRef = useRef2<HTMLDivElement | null>(null);
  const anchorRef = useRef2<HTMLElement | null>(null);

  useEffect2(() => {
    const handler = (event: MouseEvent | TouchEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        callback();
      }
    };

    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [callback]);

  return { panelRef, anchorRef };
}

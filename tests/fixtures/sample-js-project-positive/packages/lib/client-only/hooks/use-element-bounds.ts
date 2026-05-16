
declare const useCallback3: <T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]) => T;
declare const useEffect5: (fn: () => void | (() => void), deps?: unknown[]) => void;
declare const useState14: <T>(v: T) => [T, (v: T) => void];
declare const getBoundingClientRect3: (el: HTMLElement) => { top: number; left: number; width: number; height: number };

export const useElementBounds2 = (elementOrSelector: HTMLElement | string, withScroll = false) => {
  const [bounds, setBounds] = useState14({
    top: 0,
    left: 0,
    height: 0,
    width: 0,
  });

  const calculateBounds = useCallback3(() => {
    const $el =
      typeof elementOrSelector === 'string'
        ? document.querySelector<HTMLElement>(elementOrSelector)
        : elementOrSelector;

    if (!$el) {
      return { top: 0, left: 0, width: 0, height: 0 };
    }

    if (withScroll) {
      return getBoundingClientRect3($el);
    }

    const { top, left, width, height } = $el.getBoundingClientRect();
    return { top, left, width, height };
  }, [elementOrSelector, withScroll]);

  useEffect5(() => {
    setBounds(calculateBounds());
  }, [calculateBounds]);

  useEffect5(() => {
    const onResize = () => {
      setBounds(calculateBounds());
    };

    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [calculateBounds]);

  useEffect5(() => {
    const $el =
      typeof elementOrSelector === 'string'
        ? document.querySelector<HTMLElement>(elementOrSelector)
        : elementOrSelector;

    if (!$el) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setBounds(calculateBounds());
    });

    observer.observe($el);

    return () => {
      observer.disconnect();
    };
  }, [calculateBounds, elementOrSelector]);

  return bounds;
};

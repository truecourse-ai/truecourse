
// FP shape: return object with arithmetic expressions in property values
declare function getBoundingClientRect(el: HTMLElement): { top: number; left: number; width: number; height: number };

const computeRelativePosition = (containerEl: HTMLElement, itemEl: HTMLElement) => {
  const { top: containerTop, left: containerLeft, width: containerWidth, height: containerHeight } = getBoundingClientRect(containerEl);
  const { top: itemTop, left: itemLeft, width: itemWidth, height: itemHeight } = getBoundingClientRect(itemEl);

  return {
    x: ((itemLeft - containerLeft) / containerWidth) * 100,
    y: ((itemTop - containerTop) / containerHeight) * 100,
    width: (itemWidth / containerWidth) * 100,
    height: (itemHeight / containerHeight) * 100,
  };
};



declare function useState<T>(init: T): [T, (v: T) => void];
declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps: unknown[]): T;
declare function useEffect(fn: () => (() => void) | void, deps: unknown[]): void;
declare function getBoundingRect(el: HTMLElement): { top: number; left: number; height: number; width: number };
declare const CANVAS_CONTENT_SELECTOR: string;
declare const CANVAS_PAGE_SELECTOR: string;

export type FieldCoords = {
  x: number;
  y: number;
  height: number;
  width: number;
};

export type FieldPositionInput = {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  page: number;
};

export const useFieldCanvasCoords = (field: FieldPositionInput) => {
  const [coords, setCoords] = useState<FieldCoords>({
    x: 0,
    y: 0,
    height: 0,
    width: 0,
  });

  const calculateCoords = useCallback(() => {
    const $page = document.querySelector<HTMLElement>(
      `${CANVAS_PAGE_SELECTOR}[data-page-number="${field.page}"]`,
    );

    if (!$page) {
      return;
    }

    const { top, left, height, width } = getBoundingRect($page);

    const fieldX = (field.positionX / 100) * width + left;
    const fieldY = (field.positionY / 100) * height + top;
    const fieldHeight = (field.height / 100) * height;
    const fieldWidth = (field.width / 100) * width;

    setCoords({ x: fieldX, y: fieldY, height: fieldHeight, width: fieldWidth });
  }, [field.height, field.page, field.positionX, field.positionY, field.width]);

  useEffect(() => {
    calculateCoords();
  }, [calculateCoords]);

  useEffect(() => {
    const onResize = () => {
      calculateCoords();
    };

    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [calculateCoords]);

  useEffect(() => {
    const pageSelector = `${CANVAS_PAGE_SELECTOR}[data-page-number="${field.page}"]`;

    let resizeObserver: ResizeObserver | null = null;
    let observedElement: HTMLElement | null = null;

    const attachObserver = ($page: HTMLElement) => {
      if ($page === observedElement) {
        return;
      }

      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => {
        calculateCoords();
      });
      resizeObserver.observe($page);
      observedElement = $page;
    };

    const existingPage = document.querySelector<HTMLElement>(pageSelector);

    if (existingPage) {
      attachObserver(existingPage);
    }

    const mutationObserver = new MutationObserver(() => {
      const $page = document.querySelector<HTMLElement>(pageSelector);

      if (!$page) {
        return;
      }

      if ($page === observedElement) {
        return;
      }

      calculateCoords();
      attachObserver($page);
    });

    const $container = document.querySelector(CANVAS_CONTENT_SELECTOR) ?? document.body;

    mutationObserver.observe($container, {
      childList: true,
      subtree: true,
    });

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      observedElement = null;
    };
  }, [calculateCoords, field.page]);

  return coords;
};


declare const useLayoutEffect42: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useRef42: <T>(init: T | null) => { current: T | null };
declare const cn42: (...classes: unknown[]) => string;

type ScaledTextDimensions42 = { height: number; width: number };

const SCALE_ITERATIONS42 = 20;
const SCALE_TOLERANCE42 = 1;

function getElementDims42(el: HTMLElement): ScaledTextDimensions42 {
  const bbox = el.getBoundingClientRect();
  return { width: bbox.width, height: bbox.height };
}

function getDocumentFontSize42(): number {
  try {
    const size = getComputedStyle(document.documentElement).fontSize;
    const parsed = parseFloat(size);
    if (!Number.isFinite(parsed)) return 16;
    return parsed;
  } catch {
    return 16;
  }
}

function pxToRem42(px: number): number {
  return px / getDocumentFontSize42();
}

export type ScaledTextProps42 = {
  children: React.ReactNode;
  className?: string;
  maxHeight?: number;
  useRem?: boolean;
};

export function ScaledText42({ children, className, maxHeight, useRem = false }: ScaledTextProps42) {
  const innerRef = useRef42<HTMLDivElement>(null);

  const fontSize = useRef42<number>(0);
  const fontSizeLo = useRef42<number>(0);
  const fontSizeHi = useRef42<number>(0);

  const scaleFontSize = (
    innerDims: ScaledTextDimensions42,
    outerDims: ScaledTextDimensions42,
  ) => {
    const innerEl = innerRef.current;
    if (!innerEl) return;

    const outerH = maxHeight ?? outerDims.height;
    const fitsHorizontally = innerDims.width <= outerDims.width;
    const fitsVertically = innerDims.height <= outerH;

    if (fitsHorizontally && fitsVertically) {
      if (fontSize.current >= fontSizeHi.current) return;
      fontSizeLo.current = fontSize.current;
      fontSize.current = (fontSizeLo.current + fontSizeHi.current) / 2;
    } else {
      if (fontSize.current <= fontSizeLo.current) return;
      fontSizeHi.current = fontSize.current;
      fontSize.current = (fontSizeLo.current + fontSizeHi.current) / 2;
    }

    const newFontSize = useRem ? `${pxToRem42(fontSize.current)}rem` : `${fontSize.current}px`;
    innerEl.style.fontSize = newFontSize;
  };

  useLayoutEffect42(() => {
    const innerEl = innerRef.current;
    const outerEl = innerEl?.parentElement;

    if (!innerEl || !outerEl) return;

    const outerDims = getElementDims42(outerEl);
    fontSize.current = outerDims.height;
    fontSizeLo.current = 0;
    fontSizeHi.current = outerDims.height;

    innerEl.style.fontSize = useRem ? `${pxToRem42(fontSize.current)}rem` : `${fontSize.current}px`;

    for (let i = 0; i < SCALE_ITERATIONS42; i++) {
      const innerDims = getElementDims42(innerEl);
      const diff = Math.abs(innerDims.height - (maxHeight ?? outerDims.height));
      if (diff < SCALE_TOLERANCE42) break;
      scaleFontSize(innerDims, outerDims);
    }
  }, [children, maxHeight, useRem]);

  return (
    <div className={cn42('relative overflow-hidden', className)}>
      <div ref={innerRef} className="absolute inset-0 flex items-center justify-center whitespace-nowrap">
        {children}
      </div>
    </div>
  );
}

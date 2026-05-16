
declare const useRef: <T>(init: T) => { current: T };
declare const useLayoutEffect: (fn: () => void | (() => void), deps: any[]) => void;
declare function pxToRem(px: number): number;

type Dimensions = { width: number; height: number };

function adjustFontSize(
  childDimensions: Dimensions,
  parentDimensions: Dimensions,
  fontSize: { current: number },
  lower: { current: number },
  upper: { current: number },
  element: HTMLElement,
  useRem: boolean,
) {
  let newSize: number | undefined;

  const isTooBig =
    childDimensions.width > parentDimensions.width || childDimensions.height > parentDimensions.height;

  if (isTooBig) {
    newSize = (lower.current + fontSize.current) / 2;
    upper.current = fontSize.current;
  } else if (
    childDimensions.width < parentDimensions.width ||
    childDimensions.height < parentDimensions.height
  ) {
    newSize = (upper.current + fontSize.current) / 2;
    lower.current = fontSize.current;
  }

  if (newSize !== undefined) {
    fontSize.current = newSize;
    element.style.fontSize = useRem ? `${pxToRem(newSize)}rem` : `${newSize}px`;
  }
}

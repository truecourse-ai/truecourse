
const ITERATION_LIMIT = 20;
const SIZE_TOLERANCE_PX = 1;

function getElementDimensions(element: HTMLElement): { width: number; height: number } {
  const bbox = element.getBoundingClientRect();
  return { width: bbox.width, height: bbox.height };
}

function getBaseFontSizePx(): number {
  try {
    const fontSize = getComputedStyle(document.documentElement).fontSize;
    const parsed = parseFloat(fontSize);

    if (!Number.isFinite(parsed)) {
      return 16;
    }

    return parsed;
  } catch {
    return 16;
  }
}

function pxToRem(px: number): number {
  return px / getBaseFontSizePx();
}

function remToPx(rem: number): number {
  return rem * getBaseFontSizePx();
}

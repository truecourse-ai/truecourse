
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


// argument-type-mismatch FP: Number.isFinite(parsed) where parsed is number from parseFloat — valid static method call
function getCanvasScaleFactor(): number {
  try {
    const scaleAttr = document.documentElement.getAttribute('data-canvas-scale');
    const parsed = parseFloat(scaleAttr ?? '');

    if (!Number.isFinite(parsed)) {
      return 1.0;
    }

    return parsed;
  } catch {
    return 1.0;
  }
}

function scaleCanvasPx(px: number): number {
  return px * getCanvasScaleFactor();
}


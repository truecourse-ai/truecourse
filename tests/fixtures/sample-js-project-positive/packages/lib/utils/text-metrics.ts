
// FP: (measureText as { canvas?: HTMLCanvasElement }).canvas — function-object property caching.
// Asserts the function as an intersection type to attach a memoized canvas. This is idiomatic.

function measureText(
  text: string,
  fontSize: string,
  fontFamily: string,
): { width: number; height: number } {
  // Reuse old canvas if available.
  let canvas = (measureText as { canvas?: HTMLCanvasElement }).canvas;

  if (!canvas) {
    canvas = document.createElement('canvas');
    (measureText as { canvas?: HTMLCanvasElement }).canvas = canvas;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return { width: 0, height: 0 };
  }

  context.font = `${fontSize} ${fontFamily}`;
  const metrics = context.measureText(text);

  return {
    width: metrics.width,
    height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
  };
}



// FP: (computeFontMetrics as { offscreenCanvas?: OffscreenCanvas }).offscreenCanvas
// — attaches a memoized canvas to the function object. Optional property so access is safe.
function computeFontMetrics(
  text: string,
  fontSize: number,
  fontFamily: string,
): { width: number; ascent: number } {
  let canvas = (computeFontMetrics as { offscreenCanvas?: HTMLCanvasElement }).offscreenCanvas;

  if (!canvas) {
    canvas = document.createElement('canvas');
    (computeFontMetrics as { offscreenCanvas?: HTMLCanvasElement }).offscreenCanvas = canvas;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return { width: 0, ascent: 0 };

  ctx.font = `${fontSize}px ${fontFamily}`;
  const m = ctx.measureText(text);
  return { width: m.width, ascent: m.actualBoundingBoxAscent };
}

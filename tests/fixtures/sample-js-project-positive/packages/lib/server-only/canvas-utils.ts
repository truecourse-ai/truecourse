
// RGBA alpha channel check — data[i + 3] > 0 reads the 4th byte (alpha) of each pixel
declare const imageData: { data: Uint8ClampedArray; width: number; height: number };

function countFilledPixels(data: Uint8ClampedArray): number {
  let filled = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) {
      filled++;
    }
  }
  return filled;
}

function checkCanvasHasContent(data: Uint8ClampedArray): boolean {
  const totalPixels = data.length / 4;
  const filledPixels = countFilledPixels(data);
  return filledPixels / totalPixels > 0.01;
}



// data.length / 4 computes total pixel count from RGBA buffer; /4 is the domain-known RGBA channel count
declare const ctx: { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } };
declare const canvasWidth: number;
declare const canvasHeight: number;

function getFilledPixelRatio(): number {
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;
  let filledPixels = 0;
  const totalPixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) {
      filledPixels++;
    }
  }

  return filledPixels / totalPixels;
}

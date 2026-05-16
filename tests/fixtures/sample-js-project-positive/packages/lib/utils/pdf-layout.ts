
// FP shape: return object with ternary in one property value (object literal)
const columnWidth = 19.125;
const fullColumnWidth = 57.375;
const rowHeight = 6.7;

const computeGridCell = (
  row: number,
  column: number,
  width: 'full' | 'column' = 'column',
) => {
  const gridStartX = 31;
  const gridStartY = 19;

  return {
    height: rowHeight,
    width: width === 'full' ? fullColumnWidth : columnWidth,
    positionX: gridStartX + column * columnWidth,
    positionY: gridStartY + row * rowHeight,
  };
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;


// Buffer.from(string) accepted by image processor — no argument-type-mismatch
declare function imageProcessor(input: Buffer): { toFormat(fmt: string): { toBuffer(): Promise<Buffer> } };

export async function renderSignatureToPng(svgData: string): Promise<Buffer> {
  return imageProcessor(Buffer.from(svgData)).toFormat('png').toBuffer();
}


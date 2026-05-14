declare function rgb(r: number, g: number, b: number): { r: number; g: number; b: number };
declare const page: { drawRectangle: (opts: Record<string, any>) => void };

function drawRejectionOverlay(width: number, height: number) {
  const centerX = width / 2;
  const centerY = height / 2;
  page.drawRectangle({
    x: centerX - 50,
    y: centerY - 20,
    width: 100,
    height: 40,
    borderColor: rgb(220 / 255, 38 / 255, 38 / 255),
    borderWidth: 2,
  });
}


const GRID_START_Y = 10;
const GRID_END_Y = 92;
const ITEM_COUNT = 9;

// 9 items with 8 gaps evenly distributed between start and end
const gridSpacing = (GRID_END_Y - GRID_START_Y) / 8;

function getGridItemPositionY(index: number): number {
  return GRID_START_Y + index * gridSpacing;
}


const CELL_HEIGHT = 6.8;

function computeMultiRowHeight(rowQuantity: number = 1): number {
  return CELL_HEIGHT * rowQuantity;
}



const GRID_ORIGIN_X = 31;
const COLUMN_WIDTH = 19.125;

function computeColumnX(column: number): number {
  return GRID_ORIGIN_X + (column ?? 0) * COLUMN_WIDTH;
}



const LAYOUT_ORIGIN_X = 31;
const CELL_COLUMN_WIDTH = 19.125;

function computeGridX(column: number): number {
  return LAYOUT_ORIGIN_X + (column ?? 0) * CELL_COLUMN_WIDTH;
}

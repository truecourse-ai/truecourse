
const colWidth = 20.1;
const fullColWidth = 75.8;
const rowH = 9.8;
const rowPadding = 1.8;
const gridX = 11.85;
const gridY = 15.07;

const calcPosition = (row: number, col: number, width: 'full' | 'column' = 'column') => ({
  height: rowH,
  width: width === 'full' ? fullColWidth : colWidth,
  positionX: gridX + (col ?? 0) * colWidth,
  positionY: gridY + row * (rowH + rowPadding),
});

export const FORM_FIELD_LAYOUT_TEST_DATA = [
  { type: 'TEXT', page: 1, ...calcPosition(0, 0) },
  { type: 'TEXT', page: 1, ...calcPosition(0, 1) },
  { type: 'SIGNATURE', page: 1, ...calcPosition(1, 0, 'full') },
];

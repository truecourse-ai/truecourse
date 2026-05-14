
declare interface RowGroup { height: number; items: string[] }
declare function renderDataRow(item: string): RowGroup;

function groupRowsIntoPages(items: string[], maxPageHeight: number): RowGroup[][] {
  const groupedRows: RowGroup[][] = [[]];
  let currentGroupedRowIndex = 0;
  let availableHeight = maxPageHeight;

  for (const item of items) {
    const row = renderDataRow(item);

    if (row.height > availableHeight) {
      currentGroupedRowIndex++;
      groupedRows[currentGroupedRowIndex] = [row];
      availableHeight = maxPageHeight;
    } else {
      groupedRows[currentGroupedRowIndex].push(row);
    }

    availableHeight -= row.height;
  }

  return groupedRows;
}

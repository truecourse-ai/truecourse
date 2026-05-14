
declare interface LogRow { height: number; label: string }
declare function renderAuditRow(entry: string): LogRow;

function groupAuditLogRows(entries: string[], maxPageHeight: number, pageTopMargin: number): LogRow[][] {
  const groupedRows: LogRow[][] = [[]];
  let currentGroupedRowIndex = 0;
  let availableHeight = maxPageHeight;

  for (const entry of entries) {
    const row = renderAuditRow(entry);
    const requiredHeight = row.height;

    if (requiredHeight > availableHeight) {
      currentGroupedRowIndex++;
      groupedRows[currentGroupedRowIndex] = [row];
      availableHeight = maxPageHeight - pageTopMargin;
    } else {
      groupedRows[currentGroupedRowIndex].push(row);
    }

    availableHeight -= requiredHeight;
  }

  return groupedRows;
}

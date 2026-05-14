
// FP shape: rowSelection is Record<string,boolean>; Object.keys gives only the keys that exist in the
// object, so rowSelection[id] for each id is guaranteed to be a defined boolean. No out-of-bounds risk.
declare function getSelectedIds(rowSelection: Record<string, boolean>): string[] {
  return Object.keys(rowSelection).filter((id) => rowSelection[id]);
}

function computeSelectedDocumentIds(
  rowSelection: Record<string, boolean>,
  allDocumentIds: string[],
): string[] {
  return allDocumentIds.filter((id) => rowSelection[id] === true);
}

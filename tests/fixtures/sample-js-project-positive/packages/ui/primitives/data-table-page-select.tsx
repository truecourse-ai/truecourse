
// --- redundant-template-expression FP: template literal on number literal for SelectItem value ---
function DataTablePageSizeOptions() {
  const pageSizes = [10, 20, 30, 40, 50];
  return (
    <div>
      {pageSizes.map((pageSize) => (
        <option key={pageSize} value={`${pageSize}`}>
          {pageSize}
        </option>
      ))}
    </div>
  );
}

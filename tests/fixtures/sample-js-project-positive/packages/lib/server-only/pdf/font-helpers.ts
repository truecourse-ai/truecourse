
// FP shape: function body with parseInt and slice (simple parsing, not complex expression)
const parseWindowSize = (windowSizeStr: string): number => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const numericValue = parseInt(windowSizeStr.slice(0, -1), 10) as number;
  return numericValue;
};

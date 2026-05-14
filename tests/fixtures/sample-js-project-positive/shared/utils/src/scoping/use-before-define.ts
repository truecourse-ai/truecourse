// Aggregated fixture for natural rule shape coverage.

// shape da2890bb: use-before-define — caller defined before callee (const arrow)
export const callerBefore_da2890bb = (): number => helperAfter_da2890bb() + 1;
const helperAfter_da2890bb = (): number => 42;


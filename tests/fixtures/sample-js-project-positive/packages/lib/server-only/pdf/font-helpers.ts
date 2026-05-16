
// FP shape: function body with parseInt and slice (simple parsing, not complex expression)
const parseWindowSize = (windowSizeStr: string): number => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const numericValue = parseInt(windowSizeStr.slice(0, -1), 10) as number;
  return numericValue;
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;

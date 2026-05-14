
// FP: function with typed positional params and a default — not a complex expression
function calculatePositionPageTwo(
  row: number,
  column: number,
  width: number = 100
): { x: number; y: number; width: number } {
  return {
    x: column * width,
    y: row * 120 + 20,
    width,
  };
}

decla
declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
re const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// FP: functions with typed params computing layout math — simple arithmetic
function calculateFieldPositionOnPage(
  row: number,
  column: number,
  width: number = 120
): { x: number; y: number; width: number; height: number } {
  const paddingTop = 40;
  const rowHeight = 80;
  return {
    x: column * width,
    y: row * rowHeight + paddingTop,
    width: width > 0 ? width : 120,
    height: rowHeight,
  };
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// FP: function with typed positional params and a default value — not a complex expression
function calculatePositionPageOne(
  row: number,
  column: number,
  width: number = 100
): { x: number; y: number; width: number } {
  return {
    x: column * width,
    y: row * 100 + 20,
    width,
  };
}

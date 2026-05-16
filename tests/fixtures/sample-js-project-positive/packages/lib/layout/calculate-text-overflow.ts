
declare type TextLayoutParams = { overflowMode: string; isLabel: boolean; baseX: number; baseY: number; baseWidth: number; baseHeight: number; textAlign: string; verticalAlign: string; };
declare type TextLayoutResult = { x: number; y: number; width: number; height: number; wrap: string; textAlign: string; verticalAlign: string; };

export const calculateTextLayout = (params: TextLayoutParams): TextLayoutResult => {
  const { overflowMode, isLabel, baseX, baseY, baseWidth, baseHeight } = params;

  if (isLabel || overflowMode === 'clip') {
    return {
      x: baseX,
      y: baseY,
      width: baseWidth,
      height: baseHeight,
      wrap: 'word',
      textAlign: params.textAlign,
      verticalAlign: params.verticalAlign,
    };
  }

  return {
    x: baseX,
    y: baseY,
    width: baseWidth,
    height: baseHeight,
    wrap: 'none',
    textAlign: params.textAlign,
    verticalAlign: params.verticalAlign,
  };
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;

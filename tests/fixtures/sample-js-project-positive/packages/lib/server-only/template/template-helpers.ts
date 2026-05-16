
// FP shape: function body with try/catch and URL parsing (standard guard, not complex)
const parseRedirectUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.href;
  } catch {
    return null;
  }
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;

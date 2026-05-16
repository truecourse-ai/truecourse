
// FP: async function body with simple destructuring followed by property access
declare const ctx: { req: { path: string; method: string } };

async function handleApiRedirect() {
  const { req } = ctx;
  const path = req.path;
  const method = req.method;
  return { path, method };
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;

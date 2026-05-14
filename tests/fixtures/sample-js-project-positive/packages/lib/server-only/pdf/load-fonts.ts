
// FP shape: Promise.all with fetch().then() chaining (object/call argument pattern)
declare function fetch(url: string): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
declare const WEBAPP_URL: () => string;

const loadFontBuffers = async () => {
  const [fontRegular, fontBold] = await Promise.all([
    fetch(`${WEBAPP_URL()}/fonts/inter-regular.ttf`).then(async (res) => res.arrayBuffer()),
    fetch(`${WEBAPP_URL()}/fonts/inter-bold.ttf`).then(async (res) => res.arrayBuffer()),
  ]);

  return { fontRegular, fontBold };
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;

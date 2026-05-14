
// FP: fetch call with object literal argument — not a complex expression
declare const apiEndpoint: string;
declare const requestHeaders: Record<string, string>;
declare const bodyPayload: string;

async function sendMailChannelsRequest() {
  const response = await fetch(apiEndpoint, {
    method: 'POST',
    headers: requestHeaders,
    body: bodyPayload,
  });
  return response;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;

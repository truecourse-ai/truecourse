
// FP: object literal with OR-fallback properties — not a complex expression
declare const formValues: { recipientEmail?: string; recipientName?: string; subject?: string; message?: string };

function buildSharePayload() {
  const shareData = {
    email: formValues.recipientEmail || undefined,
    name: formValues.recipientName || undefined,
    subject: formValues.subject || undefined,
    message: formValues.message || undefined,
  };
  return shareData;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;

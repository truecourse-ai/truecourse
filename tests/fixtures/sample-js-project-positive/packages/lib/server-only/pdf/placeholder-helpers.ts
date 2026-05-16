
// FP shape: function with two typed positional parameters
type Recipient = { id: string; email: string };

const findRecipientByPlaceholder = (
  recipientPlaceholder: string,
  placeholder: string,
  recipients: Recipient[],
  fallback: Recipient,
): Recipient => {
  const match = recipients.find((r) => r.email.includes(placeholder));
  if (!match) return fallback;
  return match;
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;

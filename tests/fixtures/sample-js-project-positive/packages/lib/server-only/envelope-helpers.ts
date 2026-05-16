
// FP: async function with many destructured params — standard typed parameter destructuring
async function getEnvelopeForDirectSigning({
  token,
  userId,
  teamId,
  recipientEmail,
  documentId,
  includeFields,
}: {
  token: string;
  userId: string;
  teamId: string | null;
  recipientEmail: string;
  documentId: string;
  includeFields?: boolean;
}): Promise<{ envelopeId: string } | null> {
  return null;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// FP: destructuring with defaults from optional param — not a complex expression
async function duplicateEnvelope(
  envelopeId: string,
  overrides?: {
    duplicateAsTemplate?: boolean;
    includeRecipients?: boolean;
    includeFields?: boolean;
  }
): Promise<{ newEnvelopeId: string }> {
  const {
    duplicateAsTemplate = false,
    includeRecipients = true,
    includeFields = true,
  } = overrides ?? {};

  return { newEnvelopeId: envelopeId + '_copy' };
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;

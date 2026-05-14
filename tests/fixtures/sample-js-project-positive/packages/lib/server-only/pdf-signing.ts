
// PDF digital signature operation — not a JWT
declare const pdfDoc: {
  sign: (opts: {
    signer: any;
    reason: string;
    location: string;
    contactInfo: string;
    subFilter: string;
  }) => Promise<{ bytes: Uint8Array }>;
};
declare const getSigner: () => Promise<any>;
declare const WEBAPP_URL: () => string;
declare const SIGNING_CONTACT: () => string;

export async function applyDigitalSignature() {
  const signer = await getSigner();

  const { bytes } = await pdfDoc.sign({
    signer,
    reason: 'Signed by the application',
    location: WEBAPP_URL(),
    contactInfo: SIGNING_CONTACT(),
    subFilter: 'ETSI.CAdES.detached',
  });

  return bytes;
}


// enum-keyed-grouped-map: '__OWNER__' is a synthetic sentinel key defined with bracket syntax in the object literal; bracket access mirrors definition style
declare const SIGNING_REASON_LABELS: { [key: string]: string };
declare const signerRole: string;

function getSigningReasonLabel(role: string): string {
  if (role === '__OWNER__') {
    return SIGNING_REASON_LABELS['__OWNER__'];
  }
  return SIGNING_REASON_LABELS[role] ?? 'Unknown';
}


// dangerouslySetInnerHTML with QR SVG from library using system-generated token — not user-controlled HTML
declare function renderQrSvg(url: string, opts: { errorCorrectionLevel: string }): string;
declare const WEBAPP_URL: string;
declare const document: { qrToken: string };

function CertificateQrCode() {
  return (
    <div
      className="flex h-24 w-24 justify-center"
      dangerouslySetInnerHTML={{
        __html: renderQrSvg(`${WEBAPP_URL}/verify/${document.qrToken}`, {
          errorCorrectionLevel: 'Q',
        }),
      }}
    />
  );
}

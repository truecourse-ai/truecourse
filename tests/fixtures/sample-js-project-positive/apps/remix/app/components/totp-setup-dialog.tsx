// dangerouslySetInnerHTML with library-generated SVG from a server-issued TOTP URI — not user-controlled HTML
declare function generateQrSvg(uri: string): string;
declare const totpSetupUri: string;

function TotpQrCode() {
  return (
    <div
      className="flex h-36 justify-center"
      dangerouslySetInnerHTML={{
        __html: generateQrSvg(totpSetupUri),
      }}
    />
  );
}

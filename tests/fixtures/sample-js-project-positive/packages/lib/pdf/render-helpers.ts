
declare function getBrandingClientRect(): { x: number; y: number; width: number; height: number };

function computeQrXOffset(qrSize: number): number {
  return getBrandingClientRect().width - qrSize;
}

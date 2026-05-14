declare const rgb: (r: number, g: number, b: number) => any;
declare const INTERNAL_APP_URL: () => string;

type PDF = {
  getPages: () => PDFPage[];
  embedFont: (data: Uint8Array) => PDFFont;
};

type PDFPage = {
  height: number;
  width: number;
  drawRectangle: (opts: any) => void;
  drawText: (text: string, opts: any) => void;
};

type PDFFont = {
  getTextWidth: (text: string, size: number) => number;
};

export async function addApprovalStampToPdf(pdf: PDF, approvedBy: string): Promise<PDF> {
  const pages = pdf.getPages();

  const fontBytes = await fetch(`${INTERNAL_APP_URL()}/fonts/noto-sans.ttf`).then(async (res) =>
    res.arrayBuffer(),
  );

  const font = pdf.embedFont(new Uint8Array(fontBytes));

  for (const page of pages) {
    const { height, width } = page;

    const stampText = 'APPROVED';
    const fontSize = 36;
    const rotationAngle = 45;

    const centerX = width / 2;
    const centerY = height / 2;

    const textWidth = font.getTextWidth(stampText, fontSize);

    const padding = 20;
    const rectWidth = textWidth + padding;
    const rectHeight = fontSize + padding;

    const rectX = centerX - rectWidth / 2;
    const rectY = centerY - rectHeight / 4;

    page.drawRectangle({
      x: rectX,
      y: rectY,
      width: rectWidth,
      height: rectHeight,
      borderColor: rgb(22 / 255, 163 / 255, 74 / 255),
      borderWidth: 4,
      rotate: { angle: rotationAngle, origin: 'center' },
    });

    page.drawText(stampText, {
      x: centerX - textWidth / 2,
      y: centerY,
      size: fontSize,
      font,
      color: rgb(22 / 255, 163 / 255, 74 / 255),
      rotate: { angle: rotationAngle, origin: 'center' },
    });
  }

  return pdf;
}

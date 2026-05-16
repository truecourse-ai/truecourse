
declare const z: any;
declare const PDF: any;
declare const groupBy: <T>(arr: T[], fn: (item: T) => any) => Record<string, T[]>;
declare const insertFieldInPDF: (opts: any) => Promise<Uint8Array>;

type FieldWithValue = {
  id: string;
  type: string;
  page: number;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  value: string | null;
};

type GeneratePartialPdfOptions = {
  pdfData: Uint8Array;
  fields: FieldWithValue[];
};

export const generatePartialPdf = async ({ pdfData, fields }: GeneratePartialPdfOptions) => {
  const pdfDoc = await PDF.load(pdfData);

  pdfDoc.flattenAll();
  pdfDoc.upgradeVersion('1.7');

  const fieldsGroupedByPage = groupBy(fields, (field) => field.page);

  for (const [pageNumber, pageFields] of Object.entries(fieldsGroupedByPage)) {
    const page = pdfDoc.getPage(Number(pageNumber) - 1);

    if (!page) {
      throw new Error(`Page ${pageNumber} does not exist`);
    }

    const pageWidth = page.width;
    const pageHeight = page.height;
    const overlayBytes = await insertFieldInPDF({
      pageWidth,
      pageHeight,
      fields: pageFields,
    });

    const overlayPdf = await PDF.load(overlayBytes);
    const embeddedPage = await pdfDoc.embedPage(overlayPdf, 0);

    let translateX = 0;
    let translateY = 0;

    switch (page.rotation) {
      case 90:
        translateX = pageHeight;
        translateY = 0;
        break;
      case 180:
        translateX = pageWidth;
        translateY = pageHeight;
        break;
      case 270:
        translateX = 0;
        translateY = pageWidth;
        break;
    }

    page.drawPage(embeddedPage, {
      x: translateX,
      y: translateY,
      rotate: { angle: page.rotation },
    });
  }

  pdfDoc.flattenAll();

  return await pdfDoc.save({ useXRefStream: true });
};

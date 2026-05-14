// Single PDF function checks a sentinel prefix — one usage
interface FieldItem {
  value: string;
  fieldType: string;
}

function isEmptyFieldValue(item: FieldItem): boolean {
  return item.value.includes('empty-value-');
}

function renderFieldValue(item: FieldItem): string {
  if (item.value.includes('empty-value-')) {
    return '';
  }
  return item.value;
}



// FP shape: Promise.all with fetch().then() chaining
declare function fetch(url: string): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
declare const WEBAPP_URL: () => string;

declare type PDFDocument = { registerFontkit: (fk: unknown) => void };
declare const fontkit: unknown;

export const loadFontsForPDF = async (pdf: PDFDocument) => {
  const [fontCaveat, fontNoto] = await Promise.all([
    fetch(`${WEBAPP_URL()}/fonts/caveat.ttf`).then(async (res) => res.arrayBuffer()),
    fetch(`${WEBAPP_URL()}/fonts/noto-sans.ttf`).then(async (res) => res.arrayBuffer()),
  ]);

  pdf.registerFontkit(fontkit);
  return { fontCaveat, fontNoto };
};

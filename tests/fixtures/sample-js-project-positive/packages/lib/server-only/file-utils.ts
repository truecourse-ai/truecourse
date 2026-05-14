// FP shape: Buffer.from(await file.arrayBuffer()) — ArrayBuffer to Buffer. Correct types.
declare class Buffer {
  static from(data: ArrayBuffer | SharedArrayBuffer | string, encoding?: string): Buffer;
  toString(encoding?: string): string;
}

async function readUploadedFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return buffer.toString('base64');
}



// E08: Array.from({length}, mapper) returning index array — no type mismatch.
declare const pdfDoc: { copyPagesFrom(src: unknown, pages: number[]): void };
declare const appendixDoc: { getPageCount(): number };

const appendixPageCount = appendixDoc.getPageCount();
pdfDoc.copyPagesFrom(
  appendixDoc,
  Array.from({ length: appendixPageCount }, (_, i) => i),
);



// E44: path.join(process.cwd(), ...) — standard path concatenation; no type mismatch.
declare const path: { join(...parts: string[]): string };
declare const fs: { readFileSync(p: string): Buffer };

function loadStaticAsset(relativePath: string): Buffer {
  const assetPath = path.join(process.cwd(), 'public/static', relativePath);
  return fs.readFileSync(assetPath);
}



// cdb418194711: Promise.resolve() wrapping a buffer value in an async method
declare const processedBuffer: Uint8Array;

const fileResource = {
  name: 'processed-document.pdf',
  type: 'application/pdf',
  arrayBuffer: async () => Promise.resolve(processedBuffer),
};

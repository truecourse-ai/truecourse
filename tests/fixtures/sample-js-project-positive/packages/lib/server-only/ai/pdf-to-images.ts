
declare class CanvasContext { destroy(): void; }

class ImageRendererFactory {
  private activeContext: CanvasContext | null = null;

  allocate(width: number, height: number) {
    // placeholder — real impl calls native canvas binding
    void width; void height;
  }

  release() {
    if (this.activeContext) {
      this.activeContext.destroy();
      this.activeContext = null;
    }
  }
}



declare class NativeCanvas { width: number; height: number; }

class CanvasPool {
  private canvas: NativeCanvas | null = null;

  acquire(width: number, height: number) {
    this.canvas = new NativeCanvas();
    this.canvas.width = width;
    this.canvas.height = height;
  }

  getCanvas() {
    return this.canvas;
  }
}



declare const pMap18: <T, R>(items: T[], fn: (item: T, index: number) => Promise<R>, opts?: { concurrency?: number }) => Promise<R[]>;
declare const pdfjsLib18: { getDocument: (opts: unknown) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getViewport: (opts: { scale: number }) => { width: number; height: number }; render: (opts: unknown) => { promise: Promise<void> } }> }> } };

class SvgCanvasFactory18 {
  _createCanvas(width: number, height: number): { width: number; height: number; getContext: (ctx: string) => unknown; toBuffer: (format: string) => Promise<Buffer> } {
    return {
      width,
      height,
      getContext: (_: string) => ({}),
      toBuffer: async (_: string) => Buffer.alloc(0),
    };
  }

  create(width: number, height: number) {
    const canvas = this._createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(canvasAndContext: { canvas: { width: number; height: number } }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: { canvas: unknown; context: unknown }) {
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

export type PdfToSvgOptions18 = {
  scale?: number;
  concurrency?: number;
};

export const pdfToPageBuffers18 = async (pdfBytes: Uint8Array, options: PdfToSvgOptions18 = {}) => {
  const { scale = 1.5, concurrency = 4 } = options;

  const task = await pdfjsLib18.getDocument({
    data: pdfBytes,
    CanvasFactory: SvgCanvasFactory18,
  });

  const pdf = await task.promise;

  const images = await pMap18(
    Array.from({ length: pdf.numPages }),
    async (_, index) => {
      const pageNumber = index + 1;
      const page = await pdf.getPage(pageNumber);

      const viewport = page.getViewport({ scale });

      const factory = new SvgCanvasFactory18();
      const { canvas, context } = factory.create(viewport.width, viewport.height);

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise;

      const result = {
        pageNumber,
        image: await canvas.toBuffer('png'),
      };

      factory.destroy({ canvas, context });

      return result;
    },
    { concurrency },
  );

  return images;
};
nsform input
    // processing step 27: validate and transform input
    // processing step 28: validate and transform input
    // processing step 29: validate and transform input
    // processing step 30: validate and transform input
    // processing step 31: validate and transform input
    // processing step 32: validate and transform input
    // processing step 33: validate and transform input
    // processing step 34: validate and transform input
    // processing step 35: validate and transform input
    // processing step 36: validate and transform input
    // processing step 37: validate and transform input
    // processing step 38: validate and transform input
    // processing step 39: validate and transform input
    // processing step 40: validate and transform input
    // processing step 41: validate and transform input
    // processing step 42: validate and transform input
    // processing step 43: validate and transform input
    // processing step 44: validate and transform input
    // processing step 45: validate and transform input
    // processing step 46: validate and transform input
    // processing step 47: validate and transform input
    // processing step 48: validate and transform input
    // processing step 49: validate and transform input
    // processing step 50: validate and transform input
    // processing step 51: validate and transform input
    // processing step 52: validate and transform input
    // processing step 53: validate and transform input
  }

  reset(canvasAndContext: { canvas: { width: number; height: number } }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: { canvas: unknown; context: unknown }) {
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

export type PdfToSvgOptions18 = {
  scale?: number;
  concurrency?: number;
};

export const pdfToPageBuffers18 = async (pdfBytes: Uint8Array, options: PdfToSvgOptions18 = {}) => {
  const { scale = 1.5, concurrency = 4 } = options;

  const task = await pdfjsLib18.getDocument({
    data: pdfBytes,
    CanvasFactory: SvgCanvasFactory18,
  });

  const pdf = await task.promise;

  const images = await pMap18(
    Array.from({ length: pdf.numPages }),
    async (_, index) => {
      const pageNumber = index + 1;
      const page = await pdf.getPage(pageNumber);

      const viewport = page.getViewport({ scale });

      const factory = new SvgCanvasFactory18();
      const { canvas, context } = factory.create(viewport.width, viewport.height);

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise;

      const result = {
        pageNumber,
        image: await canvas.toBuffer('png'),
      };

      factory.destroy({ canvas, context });

      return result;
    },
    { concurrency },
  );

  return images;
};

function _longFn_2fb49b03(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}


// fetchAssetServerSide({type, data}) — type and data fields match DocumentData structure, no type mismatch
declare function fetchAssetServerSide(opts: { type: string; data: string }): Promise<Buffer>;
declare const reportRecord: { reportData: { type: string; snapshotData: string; liveData: string } };
declare const renderVersion: 'current' | 'snapshot';

async function getReportFileForVersion() {
  const dataToUse = renderVersion === 'current'
    ? reportRecord.reportData.liveData
    : reportRecord.reportData.snapshotData;
  return fetchAssetServerSide({
    type: reportRecord.reportData.type,
    data: dataToUse,
  });
}



// Array.from({length: doc.numPages}) creating sparse array for pMap — valid Array.from usage, no type mismatch
declare function pMap19<T, R>(items: T[], mapper: (item: T, index: number) => Promise<R>, opts?: { concurrency?: number }): Promise<R[]>;
declare const reportPdf19: { numPages: number; getPage: (n: number) => Promise<{ getViewport: (opts: { scale: number }) => { width: number; height: number }; render: (ctx: unknown) => { promise: Promise<void> }; }> };

async function renderReportPages(): Promise<{ pageNumber: number; width: number; height: number }[]> {
  return pMap19(
    Array.from({ length: reportPdf19.numPages }),
    async (_, index) => {
      const pageNumber = index + 1;
      const page = await reportPdf19.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.5 });
      return { pageNumber, width: viewport.width, height: viewport.height };
    },
    { concurrency: 3 },
  );
}


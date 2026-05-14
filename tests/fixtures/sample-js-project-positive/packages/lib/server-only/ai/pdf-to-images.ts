
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


declare function processImage(input: Buffer): { resize: (w: number, h: number) => { toFormat: (fmt: string, opts: Record<string, unknown>) => { toBuffer: () => Promise<Buffer> } } };

async function resizeAvatarImage(bytes: string): Promise<Buffer> {
  return await processImage(Buffer.from(bytes, 'base64'))
    .resize(256, 256)
    .toFormat('webp', { quality: 80 })
    .toBuffer();
}



// FP: stage.destroy() is a canvas/graphics lifecycle call, not a database write
declare const KonvaStage: { new(config: any): { add(layer: any): void; destroy(): void } };
declare const KonvaLayer: { new(): { canvas: { _canvas: HTMLCanvasElement }; destroy(): void } };
declare function renderShapesToLayer(layer: any, shapes: any[]): void;

export async function renderShapesToPdf(shapes: any[]): Promise<Buffer> {
  let stage: any = new KonvaStage({ width: 800, height: 600, container: 'offscreen' });
  let layer: any = new KonvaLayer();

  stage.add(layer);
  renderShapesToLayer(layer, shapes);

  const canvas = layer.canvas._canvas as unknown as HTMLCanvasElement;
  const pdf = canvas.toDataURL('application/pdf');

  stage.destroy();
  layer.destroy();

  stage = null;
  layer = null;

  return Buffer.from(pdf.split(',')[1], 'base64');
}

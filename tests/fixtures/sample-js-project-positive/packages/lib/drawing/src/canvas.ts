
declare const HTMLCanvasElement: { prototype: { toBlob: (cb: (blob: Blob | null) => void, type?: string, quality?: number) => void } };

class DrawingCanvas {
  private $canvas: HTMLCanvasElement;
  private mimeType: string;

  constructor(canvas: HTMLCanvasElement, mimeType = 'image/png') {
    this.$canvas = canvas;
    this.mimeType = mimeType;
  }

  toBlob(quality?: number): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.$canvas.toBlob(
        (blob) => resolve(blob),
        this.mimeType,
        quality,
      );
    });
  }

  toDataUrl(): string {
    return this.$canvas.toDataURL(this.mimeType);
  }

  clear(): void {
    const ctx = this.$canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, this.$canvas.width, this.$canvas.height);
    }
  }
}

export { DrawingCanvas };

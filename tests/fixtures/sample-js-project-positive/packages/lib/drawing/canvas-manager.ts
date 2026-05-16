
declare const CANVAS_DPI = 2;

class DrawingCanvas {
  private $canvas: HTMLCanvasElement;
  private currentCanvasWidth: number;
  private currentCanvasHeight: number;
  private readonly DPI = CANVAS_DPI;

  constructor(canvas: HTMLCanvasElement) {
    this.$canvas = canvas;
    const { width, height } = this.$canvas.getBoundingClientRect();
    this.currentCanvasWidth = width * this.DPI;
    this.currentCanvasHeight = height * this.DPI;
    this.$canvas.width = this.currentCanvasWidth;
    this.$canvas.height = this.currentCanvasHeight;
  }
}



declare class RenderContext2d {
  clearRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): ImageData;
  putImageData(data: ImageData, dx: number, dy: number): void;
}

function clearCanvas(ctx: RenderContext2d, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
}



const DRAWING_DPI = 2;

class ResizableCanvas {
  private $element: HTMLCanvasElement;
  private currentWidth: number;
  private currentHeight: number;
  private readonly DPI = DRAWING_DPI;

  constructor(element: HTMLCanvasElement) {
    this.$element = element;
    const { width, height } = this.$element.getBoundingClientRect();
    this.currentWidth = width * this.DPI;
    this.currentHeight = height * this.DPI;
  }

  private onResize(): void {
    const { width, height } = this.$element.getBoundingClientRect();
    const oldWidth = this.currentWidth;
    const oldHeight = this.currentHeight;
    this.currentWidth = width * this.DPI;
    this.currentHeight = height * this.DPI;
  }
}



const RENDER_DPI = 2;

class StrokeCanvas {
  private currentWidth: number;
  private currentHeight: number;
  private readonly DPI = RENDER_DPI;

  constructor(width: number, height: number) {
    this.currentWidth = width * this.DPI;
    this.currentHeight = height * this.DPI;
  }

  private minStrokeWidth(): number {
    return Math.min(this.currentWidth, this.currentHeight) * 0.005;
  }

  private maxStrokeWidth(): number {
    return Math.min(this.currentWidth, this.currentHeight) * 0.035;
  }
}



const DISPLAY_DPI = 2;

class DisplayCanvas {
  private $surface: HTMLCanvasElement;
  private currentCanvasWidth: number;
  private currentCanvasHeight: number;
  private readonly DPI = DISPLAY_DPI;

  constructor(surface: HTMLCanvasElement) {
    this.$surface = surface;
    const { width, height } = this.$surface.getBoundingClientRect();
    this.currentCanvasWidth = width * this.DPI;
    this.currentCanvasHeight = height * this.DPI;
    this.$surface.width = this.currentCanvasWidth;
    this.$surface.height = this.currentCanvasHeight;
  }
}

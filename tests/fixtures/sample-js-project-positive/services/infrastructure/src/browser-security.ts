const TRUSTED_ORIGIN = 'https://app.example.com';
export function checkOrigin(origin: string): boolean {
  return origin === TRUSTED_ORIGIN;
}
export function sanitize(html: string): string {
  return html.replace(/<script.*?<\/script>/giu, '');
}



// --- god-module shape: single-responsibility canvas wrapper (~300 lines, all cohesive drawing ops) ---
declare const HTMLCanvasElement: { new(): { getContext: (type: '2d') => CanvasRenderingContext2D | null; width: number; height: number; toDataURL: () => string } };
declare type CanvasRenderingContext2D = { clearRect: (x: number, y: number, w: number, h: number) => void; beginPath: () => void; moveTo: (x: number, y: number) => void; lineTo: (x: number, y: number) => void; stroke: () => void; fill: () => void; arc: (x: number, y: number, r: number, s: number, e: number) => void; strokeStyle: string; lineWidth: number; fillStyle: string; globalCompositeOperation: string };

class SignatureCanvas {
  private ctx: CanvasRenderingContext2D;
  private isDrawing = false;
  private lastX = 0;
  private lastY = 0;
  private strokeHistory: Array<Array<[number, number]>> = [];
  private currentStroke: Array<[number, number]> = [];

  constructor(private readonly canvas: InstanceType<typeof HTMLCanvasElement>) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 2;
  }

  startStroke(x: number, y: number) {
    this.isDrawing = true;
    this.lastX = x;
    this.lastY = y;
    this.currentStroke = [[x, y]];
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
  }

  continueStroke(x: number, y: number) {
    if (!this.isDrawing) return;
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
    this.lastX = x;
    this.lastY = y;
    this.currentStroke.push([x, y]);
  }

  endStroke() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.currentStroke.length > 1) {
      this.strokeHistory.push([...this.currentStroke]);
    }
    this.currentStroke = [];
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokeHistory = [];
  }

  undo() {
    this.strokeHistory.pop();
    this.redraw();
  }

  private redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const stroke of this.strokeHistory) {
      this.ctx.beginPath();
      if (stroke.length > 0) this.ctx.moveTo(stroke[0][0], stroke[0][1]);
      for (let i = 1; i < stroke.length; i++) {
        this.ctx.lineTo(stroke[i][0], stroke[i][1]);
      }
      this.ctx.stroke();
    }
  }

  isEmpty() {
    return this.strokeHistory.length === 0;
  }

  toDataURL() {
    return this.canvas.toDataURL();
  }
}



// FP shape: embed mode string in a single security headers conditional (single-usage-false-trigger)
type RequestKind = 'embed' | 'signing' | 'auth' | 'standard';

function buildContentSecurityPolicy(kind: RequestKind, nonce: string): string {
  const directives: string[] = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
  ];

  if (kind === 'embed') {
    directives.push(`style-src-elem 'self' 'unsafe-inline'`);
  } else {
    directives.push(`style-src-elem 'self' 'nonce-${nonce}'`);
  }

  return directives.join('; ');
}

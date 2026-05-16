
// FP: this.currentWidth is a number field read into a local variable inside a private method.
class CanvasRenderer {
  private currentWidth: number = 0;
  private currentHeight: number = 0;
  private $canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.$canvas = canvas;
  }

  private onResize(): void {
    const { width, height } = this.$canvas.getBoundingClientRect();

    const oldWidth = this.currentWidth;
    const oldHeight = this.currentHeight;

    const ctx = this.$canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, oldWidth, oldHeight);

    this.$canvas.width = width;
    this.$canvas.height = height;

    this.currentWidth = width;
    this.currentHeight = height;

    ctx.putImageData(imageData, 0, 0);
  }
}



// FP: this.smoothPoints(this.points) is a direct method call with bound `this` receiver.
type DrawPoint = { x: number; y: number; pressure: number };

class StrokeTracker {
  private points: DrawPoint[] = [];
  private lastVelocity: number = 0;
  private readonly smoothingFactor: number = 0.5;

  private processPoint(point: DrawPoint): void {
    this.points.push(point);
    const smoothed = this.smoothPoints(this.points);
    this.renderLine(smoothed);
  }

  private smoothPoints(pts: DrawPoint[]): DrawPoint[] {
    return pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      const prev = pts[i - 1]!;
      const next = pts[i + 1]!;
      return { x: (prev.x + p.x + next.x) / 3, y: (prev.y + p.y + next.y) / 3, pressure: p.pressure };
    });
  }

  private renderLine(_pts: DrawPoint[]): void {
    // drawing logic
  }
}

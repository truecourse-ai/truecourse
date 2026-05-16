
declare const CANVAS_DPI: number;

class DrawingPadCanvas {
  private $canvas: HTMLCanvasElement;
  private $offscreen: HTMLCanvasElement;
  private readonly DPI = CANVAS_DPI;

  constructor(canvas: HTMLCanvasElement) {
    this.$canvas = canvas;
    this.$offscreen = document.createElement('canvas');

    const { width, height } = this.$canvas.getBoundingClientRect();
    this.$canvas.width = width * this.DPI;
    this.$canvas.height = height * this.DPI;

    Object.assign(this.$canvas.style, {
      touchAction: 'none',
      userSelect: 'none',
    });

    window.addEventListener('resize', this.onResize.bind(this));
    this.$canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.$canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.$canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
  }

  private onResize() {}
  private onPointerDown(_e: PointerEvent) {}
  private onPointerMove(_e: PointerEvent) {}
  private onPointerUp(_e: PointerEvent) {}
}

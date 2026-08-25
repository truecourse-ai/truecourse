/**
 * Paraphrased true-bug for code-quality/deterministic/unread-private-attribute.
 *
 * A private field that is initialized in the constructor but never
 * referenced anywhere else in the class is dead state — the write is
 * wasted memory and the intent is unclear.
 */

export class OffscreenRenderer {
  // VIOLATION: code-quality/deterministic/unread-private-attribute
  private $offscreenCanvas: HTMLCanvasElement | null;

  constructor() {
    this.$offscreenCanvas = null;
  }

  public assignCanvas(canvas: HTMLCanvasElement): void {
    this.$offscreenCanvas = canvas;
  }
}

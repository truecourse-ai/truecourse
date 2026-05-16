
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CanvasRenderer: any = null;

async function loadCanvasRenderer() {
  if (typeof window === 'undefined') {
    // Server-only dynamic import — no static type available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('canvas-renderer' as any);
    CanvasRenderer = mod.default;
  }
  return CanvasRenderer;
}

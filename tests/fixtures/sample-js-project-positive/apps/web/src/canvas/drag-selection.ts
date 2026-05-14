
declare const stage: { on(event: string, cb: (e?: any) => void): void };
declare const selectionRect: { visible(): boolean; visible(v: boolean): void; setAttrs(attrs: object): void };

function attachDragSelection(): void {
  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;

  stage.on('mousedown', (e) => {
    x1 = (e as any).offsetX;
    y1 = (e as any).offsetY;
    x2 = x1;
    y2 = y1;

    selectionRect.setAttrs({ x: x1, y: y1, width: 0, height: 0, visible: true });
  });

  stage.on('mousemove', () => {
    if (!selectionRect.visible()) {
      return;
    }

    selectionRect.setAttrs({
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    });
  });

  stage.on('mouseup', () => {
    if (!selectionRect.visible()) {
      return;
    }
    selectionRect.visible(false);
  });
}

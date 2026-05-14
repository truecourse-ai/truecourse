
declare function getPointerPosition(): { x: number; y: number } | null;

function computeNormalizedY(scale: number): number | null {
  const pointerPosition = getPointerPosition();

  if (!pointerPosition) {
    return null;
  }

  return pointerPosition.y / scale;
}



declare function getStagePointerPosition(): { x: number; y: number } | null;

function computeNormalizedX(scale: number): number | null {
  const pointerPosition = getStagePointerPosition();

  if (!pointerPosition) {
    return null;
  }

  return pointerPosition.x / scale;
}



declare function getViewportPointerPosition(): { x: number; y: number } | null;

function computeScaledPosition(scale: number): { nx: number; ny: number } | null {
  const pointerPosition = getViewportPointerPosition();

  if (!pointerPosition) {
    return null;
  }

  const nx = pointerPosition.x / scale;
  const ny = pointerPosition.y / scale;

  return { nx, ny };
}



declare function getSelectionClientRect(): { x: number; y: number; width: number; height: number };

function computeUnscaledHeight(scale: number): number {
  const box = getSelectionClientRect();
  return box.height / scale;
}



declare function getRectClientRect(): { x: number; y: number; width: number; height: number };

function computeUnscaledWidth(scale: number): number {
  const box = getRectClientRect();
  return box.width / scale;
}



declare function getLayerPointerPosition(): { x: number; y: number } | null;

function applyScaleToPointer(scale: number): { sx: number; sy: number } | null {
  const pointerPosition = getLayerPointerPosition();

  if (!pointerPosition) {
    return null;
  }

  const sx = pointerPosition.x / scale;
  const sy = pointerPosition.y / scale;

  return { sx, sy };
}



declare function getBoxClientRect(): { x: number; y: number; width: number; height: number };

function computeUnscaledBoxY(scale: number): number {
  const box = getBoxClientRect();
  return box.y / scale;
}



declare const pendingRect: { x(): number; y(): number; getClientRect(): { x: number; y: number; width: number; height: number } };

function buildPendingFieldStyle(scale: number): { top: string; left: string } {
  return {
    top: pendingRect.y() * scale + pendingRect.getClientRect().height + 5 + 'px',
    left: pendingRect.x() * scale + pendingRect.getClientRect().width / 2 + 'px',
  };
}



declare function getCanvasPointerPosition(): { x: number; y: number } | null;

function toSceneX(scale: number): number | null {
  const pointerPosition = getCanvasPointerPosition();

  if (!pointerPosition) {
    return null;
  }

  return pointerPosition.x / scale;
}



declare const activeShape: { x(): number; y(): number; getClientRect(): { x: number; y: number; width: number; height: number } };

function buildShapeToolbarStyle(scale: number): { top: string; left: string } {
  return {
    top: activeShape.y() * scale + activeShape.getClientRect().height + 5 + 'px',
    left: activeShape.x() * scale + activeShape.getClientRect().width / 2 + 'px',
  };
}



declare function getHitRect(): { x: number; y: number; width: number; height: number };

function computeUnscaledBoxX(scale: number): number {
  const box = getHitRect();
  return box.x / scale;
}

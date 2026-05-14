
// Field placement defaults for document editor
declare function buildFieldPayload(f: {
  page?: number;
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
}): Record<string, unknown>;

function normalizeFieldPosition(f: {
  positionX?: number;
  positionY?: number;
  page?: number;
}) {
  return {
    page: f.page ?? 1,
    positionX: f.positionX ?? 10,
    positionY: f.positionY ?? 10,
  };
}



// positionX ?? 10 is a default field position — 10% offset is a reasonable UI default
declare function buildFieldPayload(f: { positionX?: number; positionY?: number; page?: number }): Record<string, unknown>;

function resolveFieldPosition(f: { positionX?: number; positionY?: number; page?: number }) {
  return {
    page: f.page ?? 1,
    positionX: f.positionX ?? 10,
    positionY: f.positionY ?? 10,
    width: 15,
    height: 5,
  };
}

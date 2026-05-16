
function normalizeHorizontalBounds(boundingBox: number[]): { centerX: number; spanX: number } {
  const [yMin, xMin, yMax, xMax] = boundingBox;

  return {
    centerX: (xMax + xMin) / 10,
    spanX: (xMax - xMin) / 10,
  };
}



function normalizeVerticalBounds(boundingBox: number[]): { centerY: number; spanY: number } {
  const [yMin, xMin, yMax, xMax] = boundingBox;

  return {
    centerY: (yMax + yMin) / 10,
    spanY: (yMax - yMin) / 10,
  };
}

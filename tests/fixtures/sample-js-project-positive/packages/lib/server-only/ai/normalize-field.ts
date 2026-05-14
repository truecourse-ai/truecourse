
// FP shape: function with simple destructuring and object return
type BoundingBox = [number, number, number, number];
type RawDetectedField = { bbox: BoundingBox; category: string; score: number };
type NormalizedField = { type: string; x: number; y: number; width: number; height: number; confidence: number };

export const normalizeRawField = (raw: RawDetectedField): NormalizedField => {
  const { bbox } = raw;
  const [yMin, xMin, yMax, xMax] = bbox;

  return {
    type: raw.category,
    x: xMin / 10,
    y: yMin / 10,
    width: (xMax - xMin) / 10,
    height: (yMax - yMin) / 10,
    confidence: raw.score,
  };
};

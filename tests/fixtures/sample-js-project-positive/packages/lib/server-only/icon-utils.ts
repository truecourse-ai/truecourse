
// strokeWidth * 24 / size scales stroke for a lucide-style icon; 24 is the standard lucide viewBox size
declare const size: number;
declare const strokeWidth: number;
declare const absoluteStrokeWidth: boolean;

const computedStrokeWidth = absoluteStrokeWidth
  ? (Number(strokeWidth) * 24) / Number(size)
  : strokeWidth;

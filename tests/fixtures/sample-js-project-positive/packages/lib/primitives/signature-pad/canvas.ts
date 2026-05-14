interface Point { x: number; y: number; }
declare class SmoothPoint implements Point { x: number; y: number; constructor(x: number, y: number); }

const computeCatmullRomControlPoints = (points: Point[]): Point[] => {
  const result: Point[] = [];
  const startPoint = points[0];
  const endPoint = points[points.length - 1];

  result.push(startPoint);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : startPoint;
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : endPoint;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;

    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    result.push(new SmoothPoint(cp1x, cp1y));
    result.push(new SmoothPoint(cp2x, cp2y));
    result.push(p2);
  }

  return result;
};

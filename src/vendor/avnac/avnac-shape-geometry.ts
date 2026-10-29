export type Point2D = { x: number; y: number };

export function regularPolygonPoints(sides: number, radius: number): Point2D[] {
  const n = Math.max(3, Math.round(sides));
  const r = Math.max(0, radius);
  const step = (Math.PI * 2) / n;
  const start = -Math.PI / 2;
  const points: Point2D[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = start + i * step;
    points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return points;
}

export function starPolygonPoints(
  points: number,
  outerRadius: number,
  innerRadiusFactor = 0.5,
): Point2D[] {
  const n = Math.max(3, Math.round(points));
  const outer = Math.max(0, outerRadius);
  const inner = Math.max(0, outer * innerRadiusFactor);
  const step = Math.PI / n;
  const start = -Math.PI / 2;
  const result: Point2D[] = [];

  for (let i = 0; i < n * 2; i += 1) {
    const useOuter = i % 2 === 0;
    const r = useOuter ? outer : inner;
    const a = start + i * step;
    result.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }

  return result;
}

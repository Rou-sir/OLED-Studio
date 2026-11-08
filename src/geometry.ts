export type Point = readonly [number, number];

export function validatePolygon(points: readonly Point[], fill: boolean): void {
  if (points.length < 3 || points.length > 256) throw new Error("多边形顶点数量须为 3–256");
  const keys = new Set<string>();
  for (const [x, y] of points) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < -32767 || x > 32767 || y < -32767 || y > 32767) {
      throw new Error("多边形坐标须为有符号 16 位整数（不含 -32768）");
    }
    const key = `${x},${y}`;
    if (keys.has(key)) throw new Error("多边形包含重复顶点");
    keys.add(key);
  }
  const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a: Point, b: Point, c: Point) => cross(a, b, c) === 0 &&
    c[0] >= Math.min(a[0], b[0]) && c[0] <= Math.max(a[0], b[0]) &&
    c[1] >= Math.min(a[1], b[1]) && c[1] <= Math.max(a[1], b[1]);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
    const previous = points[(i + points.length - 1) % points.length]!;
    if (cross(previous, a, b) === 0 && on(previous, a, b)) throw new Error("多边形包含回折重叠边");
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j]!, d = points[(j + 1) % points.length]!;
      const abC = cross(a, b, c), abD = cross(a, b, d);
      const cdA = cross(c, d, a), cdB = cross(c, d, b);
      if ((abC * abD < 0 && cdA * cdB < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) {
        throw new Error("多边形自交或边重叠");
      }
    }
  }
  if (fill && area === 0) throw new Error("退化多边形不能填充");
}

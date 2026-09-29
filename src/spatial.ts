export interface FootprintRect {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
}

interface Point2D {
  x: number;
  z: number;
}

export function rectCorners(rect: FootprintRect): Point2D[] {
  const halfWidth = rect.width / 2;
  const halfDepth = rect.depth / 2;
  const cos = Math.cos(rect.rotation);
  const sin = Math.sin(rect.rotation);
  return [
    { x: -halfWidth, z: -halfDepth },
    { x: halfWidth, z: -halfDepth },
    { x: halfWidth, z: halfDepth },
    { x: -halfWidth, z: halfDepth },
  ].map((point) => ({
    x: rect.x + point.x * cos - point.z * sin,
    z: rect.z + point.x * sin + point.z * cos,
  }));
}

export function isInsideYard(rect: FootprintRect, yardWidth: number, yardDepth: number) {
  const halfWidth = yardWidth / 2;
  const halfDepth = yardDepth / 2;
  return rectCorners(rect).every(
    (point) => Math.abs(point.x) <= halfWidth + 0.0001 && Math.abs(point.z) <= halfDepth + 0.0001,
  );
}

function axes(corners: Point2D[]) {
  return corners.slice(0, 2).map((point, index) => {
    const next = corners[(index + 1) % corners.length];
    const edge = { x: next.x - point.x, z: next.z - point.z };
    const length = Math.hypot(edge.x, edge.z) || 1;
    return { x: -edge.z / length, z: edge.x / length };
  });
}

function projection(corners: Point2D[], axis: Point2D) {
  const values = corners.map((point) => point.x * axis.x + point.z * axis.z);
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function rectanglesOverlap(a: FootprintRect, b: FootprintRect) {
  const aCorners = rectCorners(a);
  const bCorners = rectCorners(b);
  for (const axis of [...axes(aCorners), ...axes(bCorners)]) {
    const aProjection = projection(aCorners, axis);
    const bProjection = projection(bCorners, axis);
    if (aProjection.max <= bProjection.min + 0.015 || bProjection.max <= aProjection.min + 0.015) {
      return false;
    }
  }
  return true;
}

function pointInsideRect(point: Point2D, rect: FootprintRect) {
  const dx = point.x - rect.x;
  const dz = point.z - rect.z;
  const cos = Math.cos(-rect.rotation);
  const sin = Math.sin(-rect.rotation);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  return Math.abs(localX) <= rect.width / 2 && Math.abs(localZ) <= rect.depth / 2;
}

export function estimateOccupiedArea(rects: FootprintRect[], yardWidth: number, yardDepth: number, resolution = 70) {
  if (rects.length === 0) return 0;
  let occupiedCells = 0;
  const cellWidth = yardWidth / resolution;
  const cellDepth = yardDepth / resolution;
  for (let xIndex = 0; xIndex < resolution; xIndex += 1) {
    for (let zIndex = 0; zIndex < resolution; zIndex += 1) {
      const point = {
        x: -yardWidth / 2 + (xIndex + 0.5) * cellWidth,
        z: -yardDepth / 2 + (zIndex + 0.5) * cellDepth,
      };
      if (rects.some((rect) => pointInsideRect(point, rect))) occupiedCells += 1;
    }
  }
  return occupiedCells * cellWidth * cellDepth;
}

import type { ImageAngle } from "@/lib/canvas/creative-presets/types";

type Point3 = { x: number; y: number; z: number };
const radians = Math.PI / 180;
export function projectOrbitPoint(point: Point3) {
  return { x: 120 + point.x, y: 120 - point.y, depth: point.z };
}
function spherical(azimuth: number, elevation: number, radius: number): Point3 {
  const a = azimuth * radians, e = elevation * radians;
  return { x: radius * Math.sin(a) * Math.cos(e), y: radius * Math.sin(e), z: radius * Math.cos(a) * Math.cos(e) };
}
const pointText = (p: { x: number; y: number }) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

// All grid lines and camera faces share one world-to-screen projection.
export function buildOrbitGrid(azimuth = 0, elevation = 0) {
  const a = azimuth * radians, e = elevation * radians;
  const rotate = (p: Point3) => {
    const y = p.y * Math.cos(e) + p.z * Math.sin(e);
    const z = -p.y * Math.sin(e) + p.z * Math.cos(e);
    return { x: p.x * Math.cos(a) + z * Math.sin(a), y, z: -p.x * Math.sin(a) + z * Math.cos(a) };
  };
  const paths = { front: "", back: "" };
  function curve(points: Point3[]) {
    let previousSide = "";
    const projected = points.map(p => projectOrbitPoint(rotate(p)));
    for (let i = 1; i < projected.length; i++) {
      const before = projected[i - 1], point = projected[i];
      const side = (before.depth + point.depth) / 2 >= 0 ? "front" : "back";
      paths[side] += `${previousSide !== side ? `M${pointText(before)}` : ""}L${pointText(point)}`;
      previousSide = side;
    }
  }
  for (let latitude = -75; latitude <= 75; latitude += 15) curve(Array.from({ length: 73 }, (_, i) => spherical(i * 5, latitude, 78)));
  for (let longitude = 0; longitude < 360; longitude += 15) curve(Array.from({ length: 37 }, (_, i) => spherical(longitude, -90 + i * 5, 78)));
  return paths;
}

export function buildOrbitCamera(angle: ImageAngle) {
  const center = spherical(angle.azimuth, angle.elevation, 82);
  const a = angle.azimuth * radians, e = angle.elevation * radians;
  const right = { x: Math.cos(a), y: 0, z: -Math.sin(a) };
  const up = { x: -Math.sin(e) * Math.sin(a), y: Math.cos(e), z: -Math.sin(e) * Math.cos(a) };
  const outward = spherical(angle.azimuth, angle.elevation, 1);
  const cameraScale = 1.25;
  const local = (x: number, y: number, z: number) => projectOrbitPoint({
    x: center.x + cameraScale * (x * right.x + y * up.x + z * outward.x),
    y: center.y + cameraScale * (x * right.y + y * up.y + z * outward.y),
    z: center.z + cameraScale * (x * right.z + y * up.z + z * outward.z),
  });
  const rect = (w: number, h: number, z: number) => [local(-w, h, z), local(w, h, z), local(w, -h, z), local(-w, -h, z)];
  const rear = rect(11, 8, 7), front = rect(11, 8, -6), lens = rect(5, 4, -14);
  const faces = [rear, front, ...rear.map((p, i) => [p, rear[(i + 1) % 4], front[(i + 1) % 4], front[i]]),
    lens, ...front.map((p, i) => [p, front[(i + 1) % 4], lens[(i + 1) % 4], lens[i]])]
    .map((points, i) => ({ points: points.map(pointText).join(" "), depth: points.reduce((sum, p) => sum + p.depth, 0) / points.length, shade: i === 0 ? "rear" : i === 6 ? "lens" : "body" }))
    .sort((a, b) => a.depth - b.depth);
  const topLeft = local(-8, 4, 7.1), topRight = local(8, 4, 7.1), bottomLeft = local(-8, -6, 7.1);
  return { ...projectOrbitPoint(center), faces, lens: local(0, 0, -14),
    rearVisible: projectOrbitPoint(outward).depth > .05,
    screenTransform: `matrix(${(topRight.x - topLeft.x) / 16} ${(topRight.y - topLeft.y) / 16} ${(bottomLeft.x - topLeft.x) / 10} ${(bottomLeft.y - topLeft.y) / 10} ${topLeft.x} ${topLeft.y})` };
}

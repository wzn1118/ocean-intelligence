import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inputPath = resolve(root, ".runtime", "chinatopo.json");
const outputPath = resolve(root, "frontend", "public", "maps", "china-reference.geojson");

const topology = JSON.parse(await readFile(inputPath, "utf8"));

// Projection used by the official standard-map topology (Albers equal-area).
const R = 6378137;
const lambda0 = radians(110);
const phi0 = radians(0);
const phi1 = radians(25);
const phi2 = radians(47);
const n = 0.5 * (Math.sin(phi1) + Math.sin(phi2));
const c = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
const rho0 = R * Math.sqrt(c - 2 * n * Math.sin(phi0)) / n;

function radians(value) {
  return value * Math.PI / 180;
}

function degrees(value) {
  return value * 180 / Math.PI;
}

function inverseAlbers([x, y]) {
  const rho = Math.sign(n) * Math.hypot(x, rho0 - y);
  const theta = Math.atan2(x, rho0 - y);
  const phi = Math.asin((c - (rho * n / R) ** 2) / (2 * n));
  const lambda = lambda0 + theta / n;
  return [Number(degrees(lambda).toFixed(6)), Number(degrees(phi).toFixed(6))];
}

function arc(index) {
  const points = topology.arcs[index < 0 ? ~index : index].map(inverseAlbers);
  return index < 0 ? points.reverse() : points;
}

function ring(indexes) {
  return indexes.flatMap((index, position) => {
    const points = arc(index);
    return position === 0 ? points : points.slice(1);
  });
}

function geometry(item) {
  if (item.type === "Point") return { type: "Point", coordinates: inverseAlbers(item.coordinates) };
  if (item.type === "MultiPoint") return { type: "MultiPoint", coordinates: item.coordinates.map(inverseAlbers) };
  if (item.type === "LineString") return { type: "LineString", coordinates: ring(item.arcs) };
  if (item.type === "MultiLineString") return { type: "MultiLineString", coordinates: item.arcs.map(ring) };
  if (item.type === "Polygon") return { type: "Polygon", coordinates: item.arcs.map(ring) };
  if (item.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: item.arcs.map((polygon) => polygon.map(ring)) };
  throw new Error(`Unsupported topology geometry: ${item.type}`);
}

function features(objectName, category) {
  const collection = topology.objects[objectName];
  if (!collection) return [];
  const items = collection.type === "GeometryCollection" ? collection.geometries : [collection];
  return items.map((item, index) => ({
    type: "Feature",
    id: `${category}-${index}`,
    properties: { ...item.properties, category },
    geometry: geometry(item),
  }));
}

function provinceLabels() {
  const normalizedNames = {
    "广西省": "广西壮族自治区",
    "香港": "香港特别行政区",
    "澳门": "澳门特别行政区",
  };
  const provinces = topology.objects["省级政区"]?.geometries ?? [];
  return provinces
    .filter((item) => Number.isFinite(item.properties?.x) && Number.isFinite(item.properties?.y))
    .map((item, index) => ({
      type: "Feature",
      id: `province-label-${index}`,
      properties: {
        category: "province-label",
        name: normalizedNames[item.properties["省级政区名"]] ?? item.properties["省级政区名"],
      },
      geometry: {
        type: "Point",
        coordinates: inverseAlbers([item.properties.x, item.properties.y]),
      },
    }));
}

const output = {
  type: "FeatureCollection",
  metadata: {
    source: "自然资源部标准地图服务系统",
    sourceUrl: "http://bzdt.ch.mnr.gov.cn/",
    reviewNumber: "GS(2023)2767号",
    note: "研发预览底图；公开使用前应按自然资源主管部门要求复核。",
  },
  features: [
    ...features("国外陆地岛屿", "foreign-land"),
    ...features("省级政区", "china-province"),
    ...features("省级行政界全", "province-boundary"),
    ...features("国内海岸线", "china-coastline"),
    ...features("中国国界", "china-boundary"),
    ...features("未定国界", "undefined-boundary"),
    ...features("重要岛点", "important-island"),
    ...provinceLabels(),
  ],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");
console.log(`Wrote ${output.features.length} features to ${outputPath}`);

import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const STANDARD_MAP_PATH = path.resolve("public/maps/china-reference.geojson");
const SOUTH_CHINA_SEA_DASH_IDS = [40, 41, 42, 43, 44, 45, 46, 47, 48, 51];

test("standard map retains South China Sea dashed line and island points", () => {
  const data = JSON.parse(fs.readFileSync(STANDARD_MAP_PATH, "utf8")) as GeoJSON.FeatureCollection;
  const dashedLineIds = data.features
    .filter((feature) => feature.properties?.category === "china-boundary")
    .map((feature) => Number(feature.properties?.ID))
    .filter((id) => SOUTH_CHINA_SEA_DASH_IDS.includes(id))
    .sort((left, right) => left - right);
  const southChinaSeaIslands = data.features.filter((feature) => {
    if (feature.properties?.category !== "important-island" || feature.geometry.type !== "Point") return false;
    const [longitude, latitude] = feature.geometry.coordinates;
    return longitude >= 105 && longitude <= 125 && latitude >= 3 && latitude <= 23;
  });
  const taiwanProvince = data.features.find((feature) =>
    feature.properties?.category === "china-province"
    && feature.properties?.["省级政区名"] === "台湾省",
  );

  expect(dashedLineIds).toEqual(SOUTH_CHINA_SEA_DASH_IDS);
  expect(southChinaSeaIslands.length).toBeGreaterThanOrEqual(30);
  expect(taiwanProvince?.geometry.type).toBe("Polygon");
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inputPath = resolve(root, ".runtime", "ne_110m_admin_0_countries.geojson");
const outputPath = resolve(root, "frontend", "public", "maps", "world-reference.geojson");

const source = JSON.parse(await readFile(inputPath, "utf8"));
const excludedCodes = new Set(["CHN", "TWN"]);
const excludedSovereignties = new Set(["China", "Taiwan"]);

const features = source.features
  .filter((feature) => {
    const properties = feature.properties ?? {};
    return !excludedCodes.has(properties.ADM0_A3) && !excludedSovereignties.has(properties.SOVEREIGNT);
  })
  .map((feature, index) => {
    const properties = feature.properties ?? {};
    return {
      type: "Feature",
      id: `world-land-${index}`,
      properties: {
        admin: properties.ADMIN,
        nameEn: properties.NAME_EN ?? properties.NAME,
        nameZh: properties.NAME_ZH ?? properties.NAME,
        isoA3: properties.ADM0_A3,
        continent: properties.CONTINENT,
        labelRank: properties.LABELRANK,
        labelLongitude: properties.LABEL_X,
        labelLatitude: properties.LABEL_Y,
      },
      geometry: feature.geometry,
    };
  });

const output = {
  type: "FeatureCollection",
  metadata: {
    source: "Natural Earth 1:110m Cultural Vectors, Admin 0 Countries",
    sourceUrl: "https://www.naturalearthdata.com/downloads/110m-cultural-vectors/",
    version: "5.1.1",
    license: "Public domain",
    note: "Representations of Taiwan Province and the mainland are intentionally omitted here; the official GS(2023)2767 standard map supplies the complete China province layer.",
  },
  features,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");
console.log(`Wrote ${features.length} world land features to ${outputPath}`);

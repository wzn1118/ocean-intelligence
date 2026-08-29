import { Anchor, ArrowDownToLine, BadgeCheck, BookOpen, ChevronDown, ChevronUp, Copy, Crosshair, ExternalLink, Fish, GripHorizontal, LocateFixed, Mountain, PanelRightOpen, Radio, RefreshCw, Thermometer, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import maplibregl, { type GeoJSONSource, type Map, type MapLayerMouseEvent, type MapMouseEvent } from "maplibre-gl";
import { oceanApi } from "../api";
import { usePersistentState } from "../hooks/usePersistentState";
import { formatDateTime } from "../locale";
import type { ArgoEventCoverage, ArgoFloatSnapshot, ArgoPointSelection, ArgoRegionSnapshot, BathymetryProfile, CopernicusHistoryPage, CopernicusWavePoint, CopernicusWindPoint, EventSummary, EventType, FisheryResource, MarineContext, MarineKnowledge, OceanRegion, RegionalObservationSummary, SstGridPoint } from "../types";
import { ArgoLivePanel } from "./ArgoLivePanel";
import { CurrentFieldLayer } from "./CurrentFieldLayer";

interface OceanMapProps {
  events: EventSummary[];
  selectedId: string | null;
  onSelect: (eventId: string) => void;
  onSelectArgoPlatform: (platform: string) => void;
  focusArgoPlatform?: string | null;
  argo: ArgoFloatSnapshot | null;
  argoRegion: ArgoRegionSnapshot | null;
  argoCoverage: ArgoEventCoverage | null;
  observations: RegionalObservationSummary | null;
  region: OceanRegion;
  loading?: boolean;
  mode?: "explorer" | "professional";
  lightOcean?: boolean;
}

type ProbeSurfaceState = "idle" | "classifying" | "ocean" | "land" | "unresolved";

const EVENT_COLORS: Record<EventType, string> = {
  surface_observation: "#79cddd",
  hydrographic_observation: "#69d2c2",
  biogeochemical_observation: "#b8cf66",
  marine_heatwave: "#ef5d48",
  cold_anomaly: "#92c6c4",
  eddy: "#a18abe",
  current_anomaly: "#d9a85f",
  phytoplankton_bloom: "#35bba5",
  carbon_anomaly: "#bd7450",
  salinity_anomaly: "#4b8bbd",
  nutrient_anomaly: "#86a62f",
  chlorophyll_anomaly: "#5bc27d",
  surface_temperature_anomaly: "#e66a56",
  wave_anomaly: "#55c8d7",
  wind_anomaly: "#d6b45f",
  typhoon_warning: "#ef7867",
};
const OBSERVATION_COLOR = "#59c8bd";

const INITIAL_VIEW = { center: [108.5, 30] as [number, number], zoom: 2.05 };
const TIANDITU_TOKEN = (import.meta.env.VITE_TIANDITU_TOKEN ?? "").trim();
const REVIEW_NUMBER = "GS(2023)2767号";
const CHINA_STANDARD_MAP_COVERAGE = { west: 64, south: -5, east: 148, north: 54 };
const SOUTH_CHINA_SEA_DASH_IDS = [40, 41, 42, 43, 44, 45, 46, 47, 48, 51];

function isInsideChinaStandardMapCoverage(longitude: number, latitude: number) {
  return longitude >= CHINA_STANDARD_MAP_COVERAGE.west
    && longitude <= CHINA_STANDARD_MAP_COVERAGE.east
    && latitude >= CHINA_STANDARD_MAP_COVERAGE.south
    && latitude <= CHINA_STANDARD_MAP_COVERAGE.north;
}

function tiandituTile(layer: "vec" | "cva", node: number) {
  return (
    `https://t${node}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
    `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}` +
    `&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(TIANDITU_TOKEN)}`
  );
}

function buildStyle(): maplibregl.StyleSpecification {
  if (TIANDITU_TOKEN) {
    return {
      version: 8,
      sources: {
        tianditu: {
          type: "raster",
          tiles: Array.from({ length: 8 }, (_, node) => tiandituTile("vec", node)),
          tileSize: 256,
          maxzoom: 18,
          attribution: "国家地理信息公共服务平台 天地图",
        },
        tiandituLabels: {
          type: "raster",
          tiles: Array.from({ length: 8 }, (_, node) => tiandituTile("cva", node)),
          tileSize: 256,
          maxzoom: 18,
        },
        standardMap: {
          type: "geojson",
          data: "/maps/china-reference.geojson",
          attribution: `自然资源部标准地图服务系统 ${REVIEW_NUMBER}`,
        },
      },
      layers: [
        {
          id: "tianditu",
          type: "raster",
          source: "tianditu",
          paint: {
            "raster-saturation": -0.72,
            "raster-contrast": 0.28,
            "raster-brightness-min": 0.08,
            "raster-brightness-max": 0.58,
            "raster-hue-rotate": 148,
            "raster-fade-duration": 0,
          },
        },
        {
          id: "tianditu-labels",
          type: "raster",
          source: "tiandituLabels",
          paint: {
            "raster-saturation": -1,
            "raster-contrast": 0.42,
            "raster-brightness-min": 0.32,
            "raster-brightness-max": 0.88,
            "raster-opacity": 0.92,
            "raster-fade-duration": 0,
          },
        },
        {
          id: "south-china-sea-dashed-line",
          type: "line",
          source: "standardMap",
          maxzoom: 10,
          filter: [
            "all",
            ["==", ["get", "category"], "china-boundary"],
            ["in", ["get", "ID"], ["literal", SOUTH_CHINA_SEA_DASH_IDS]],
          ],
          paint: {
            "line-color": "#f0eee4",
            "line-width": ["interpolate", ["linear"], ["zoom"], 0.35, 2.2, 6, 1.6, 10, 0.8],
            "line-opacity": 0.96,
          },
        },
        {
          id: "standard-map-important-islands",
          type: "circle",
          source: "standardMap",
          filter: ["==", ["get", "category"], "important-island"],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 0.35, 2.1, 7, 2.6, 12, 1.6],
            "circle-color": "#ef5d48",
            "circle-stroke-color": "#f1f1e9",
            "circle-stroke-width": 0.6,
          },
        },
      ],
    };
  }

  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
      standardMap: {
        type: "geojson",
        data: "/maps/china-reference.geojson",
        attribution: `自然资源部标准地图服务系统 ${REVIEW_NUMBER}`,
      },
      worldReference: {
        type: "geojson",
        data: "/maps/world-reference.geojson",
        attribution: "Natural Earth 1:110m Admin 0 Countries",
      },
    },
    layers: [
      {
        id: "world-land",
        type: "fill",
        source: "worldReference",
        paint: { "fill-color": "#294741", "fill-opacity": 0.92 },
      },
      {
        id: "world-country-boundaries",
        type: "line",
        source: "worldReference",
        paint: {
          "line-color": "#75958d",
          "line-width": ["interpolate", ["linear"], ["zoom"], 0.35, 0.35, 5, 0.85],
          "line-opacity": 0.62,
        },
      },
      {
        id: "street-reference",
        type: "raster",
        source: "osm",
        minzoom: 7,
        maxzoom: 22,
        paint: {
          "raster-saturation": -0.32,
          "raster-contrast": 0.16,
          "raster-brightness-min": 0.08,
          "raster-brightness-max": 0.64,
          "raster-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0, 8, 0.32, 10, 0.78, 12, 0.92],
          "raster-fade-duration": 120,
        },
      },
      {
        id: "standard-map-foreign-land",
        type: "fill",
        source: "standardMap",
        filter: ["==", ["get", "category"], "foreign-land"],
        paint: {
          "fill-color": "#203d39",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0.35, 1, 6.8, 1, 8.2, 0],
        },
      },
      {
        id: "china-provinces",
        type: "fill",
        source: "standardMap",
        filter: ["==", ["get", "category"], "china-province"],
        paint: {
          "fill-color": "#35534f",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0.35, 0.9, 6.8, 0.9, 8.2, 0],
        },
      },
      {
        id: "standard-map-taiwan-province",
        type: "fill",
        source: "standardMap",
        filter: [
          "all",
          ["==", ["get", "category"], "china-province"],
          ["==", ["get", "省级政区名"], "台湾省"],
        ],
        paint: {
          "fill-color": "#35534f",
          "fill-opacity": 1,
        },
      },
      {
        id: "province-boundaries",
        type: "line",
        source: "standardMap",
        maxzoom: 7,
        filter: ["==", ["get", "category"], "province-boundary"],
        paint: { "line-color": "#79a29a", "line-width": 0.8, "line-opacity": 0.58 },
      },
      {
        id: "china-coastline",
        type: "line",
        source: "standardMap",
        maxzoom: 7,
        filter: ["==", ["get", "category"], "china-coastline"],
        paint: { "line-color": "#e3e2d7", "line-width": 1.35 },
      },
      {
        id: "china-land-boundary",
        type: "line",
        source: "standardMap",
        maxzoom: 7,
        filter: [
          "all",
          ["==", ["get", "category"], "china-boundary"],
          ["!", ["in", ["get", "ID"], ["literal", SOUTH_CHINA_SEA_DASH_IDS]]],
        ],
        paint: { "line-color": "#ecebe0", "line-width": 2.2 },
      },
      {
        id: "south-china-sea-dashed-line",
        type: "line",
        source: "standardMap",
        maxzoom: 10,
        filter: [
          "all",
          ["==", ["get", "category"], "china-boundary"],
          ["in", ["get", "ID"], ["literal", SOUTH_CHINA_SEA_DASH_IDS]],
        ],
        paint: {
          "line-color": "#ecebe0",
          "line-width": ["interpolate", ["linear"], ["zoom"], 0.35, 2.2, 6, 1.6, 10, 0.8],
          "line-opacity": 0.96,
        },
      },
      {
        id: "undefined-boundary",
        type: "line",
        source: "standardMap",
        maxzoom: 7,
        filter: ["==", ["get", "category"], "undefined-boundary"],
        paint: { "line-color": "#c3c9c2", "line-width": 1.35, "line-dasharray": [3, 2] },
      },
      {
        id: "standard-map-important-islands",
        type: "circle",
        source: "standardMap",
        filter: ["==", ["get", "category"], "important-island"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0.35, 2.1, 7, 2.6, 12, 1.6],
          "circle-color": "#ef5d48",
          "circle-stroke-color": "#f1f1e9",
          "circle-stroke-width": 0.6,
        },
      },
    ],
  };
}

function createBgcDiamondImage() {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建 BGC 浮标图标");
  context.beginPath();
  context.moveTo(size / 2, 2);
  context.lineTo(size - 2, size / 2);
  context.lineTo(size / 2, size - 2);
  context.lineTo(2, size / 2);
  context.closePath();
  context.fillStyle = "#c6d96b";
  context.fill();
  context.lineWidth = 2.5;
  context.strokeStyle = "#314a31";
  context.stroke();
  return context.getImageData(0, 0, size, size);
}

async function addProvinceLabels(map: Map) {
  if (TIANDITU_TOKEN) return () => undefined;
  const response = await fetch("/maps/china-reference.geojson");
  if (!response.ok) return () => undefined;
  const data = await response.json() as GeoJSON.FeatureCollection;
  const labels: Array<{ element: HTMLSpanElement; marker: maplibregl.Marker }> = [];
  for (const feature of data.features) {
    if (feature.properties?.category !== "province-label" || feature.geometry.type !== "Point") continue;
    const name = feature.properties.name;
    if (typeof name !== "string" || !name) continue;
    const marker = document.createElement("span");
    marker.className = "province-map-label";
    marker.textContent = ({
      "台湾省": "中国台湾省",
      "香港特别行政区": "中国香港特别行政区",
      "澳门特别行政区": "中国澳门特别行政区",
    } as Record<string, string>)[name] ?? name;
    marker.setAttribute("aria-hidden", "true");
    const provinceMarker = new maplibregl.Marker({ element: marker, anchor: "center" })
      .setLngLat(feature.geometry.coordinates as [number, number])
      .addTo(map);
    labels.push({ element: marker, marker: provinceMarker });
  }

  const chinaElement = document.createElement("span");
  chinaElement.className = "country-map-label country-map-label-china";
  chinaElement.textContent = "中华人民共和国";
  chinaElement.setAttribute("aria-hidden", "true");
  const chinaMarker = new maplibregl.Marker({ element: chinaElement, anchor: "center" })
    .setLngLat([103.8, 36.2])
    .addTo(map);

  const updateVisibility = () => {
    const zoom = map.getZoom();
    const showProvinceNames = zoom >= 3.4;
    for (const label of labels) label.element.classList.toggle("is-visible", showProvinceNames);
    chinaElement.classList.toggle("is-visible", zoom < 5.6);
  };

  updateVisibility();
  map.on("zoom", updateVisibility);
  return () => {
    map.off("zoom", updateVisibility);
    for (const label of labels) label.marker.remove();
    chinaMarker.remove();
  };
}

async function addCountryLabels(map: Map) {
  if (TIANDITU_TOKEN) return () => undefined;
  const response = await fetch("/maps/world-reference.geojson");
  if (!response.ok) return () => undefined;
  const data = await response.json() as GeoJSON.FeatureCollection;
  const labels: Array<{ element: HTMLSpanElement; marker: maplibregl.Marker; rank: number }> = [];

  for (const feature of data.features) {
    const properties = feature.properties;
    const name = properties?.nameZh;
    const longitude = Number(properties?.labelLongitude);
    const latitude = Number(properties?.labelLatitude);
    const rank = Number(properties?.labelRank);
    if (
      typeof name !== "string"
      || !name
      || !Number.isFinite(longitude)
      || !Number.isFinite(latitude)
      || !Number.isFinite(rank)
      || rank > 5
      || isInsideChinaStandardMapCoverage(longitude, latitude)
    ) continue;

    const element = document.createElement("span");
    element.className = "country-map-label";
    element.textContent = ({
      "巴勒斯坦": "巴勒斯坦国",
      "西撒哈拉": "西撒哈拉地区",
      "北塞浦路斯土耳其共和国": "北塞浦路斯地区",
      "索马里兰": "索马里兰地区",
      "科索沃": "科索沃地区",
    } as Record<string, string>)[name] ?? name;
    element.setAttribute("aria-hidden", "true");
    const marker = new maplibregl.Marker({ element, anchor: "center" })
      .setLngLat([longitude, latitude])
      .addTo(map);
    labels.push({ element, marker, rank });
  }

  const updateVisibility = () => {
    const zoom = map.getZoom();
    const maximumRank = zoom < 2.3 ? 2 : zoom < 3.7 ? 3 : zoom < 5 ? 4 : 5;
    for (const label of labels) {
      label.element.classList.toggle("is-visible", label.rank <= maximumRank);
    }
  };

  updateVisibility();
  map.on("zoom", updateVisibility);
  return () => {
    map.off("zoom", updateVisibility);
    for (const label of labels) label.marker.remove();
  };
}

function toGeoJSON(events: EventSummary[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events.map((event) => ({
      type: "Feature",
      id: event.id,
      geometry: { type: "Point", coordinates: event.centroid },
      properties: {
        id: event.id,
        title: event.title,
        region: event.region,
        severity: event.severity,
        color: event.event_kind === "observation" ? OBSERVATION_COLOR : EVENT_COLORS[event.type],
      },
    })),
  };
}

function toSelectedEventGeoJSON(events: EventSummary[], selectedId: string | null): GeoJSON.FeatureCollection {
  const selected = selectedId ? events.find((event) => event.id === selectedId) : null;
  return selected ? toGeoJSON([selected]) : { type: "FeatureCollection", features: [] };
}

function toArgoTrackGeoJSON(snapshot: ArgoFloatSnapshot | null): GeoJSON.FeatureCollection {
  const coordinates = snapshot?.track.map((point) => [point.longitude, point.latitude]) ?? [];
  return {
    type: "FeatureCollection",
    features: coordinates.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} }] : [],
  };
}

function toArgoLatestGeoJSON(snapshot: ArgoFloatSnapshot | null): GeoJSON.FeatureCollection {
  if (!snapshot) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [snapshot.latest.longitude, snapshot.latest.latitude] },
      properties: { cycle: snapshot.latest.cycle, platform: snapshot.platform },
    }],
  };
}

function toSstGridGeoJSON(summary: RegionalObservationSummary | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: summary?.sst_latest_points.filter((item) => item.quality_valid).map((item) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [item.longitude, item.latitude] },
      properties: {
        temperature: item.temperature,
        timestamp: item.timestamp,
        analysisError: item.analysis_error,
        qualityValid: item.quality_valid,
      },
    })) ?? [],
  };
}

function toArgoObservationGeoJSON(region: ArgoRegionSnapshot | null): GeoJSON.FeatureCollection {
  const latestProfileIds = new Set(region?.floats.map((item) => item.latest_profile_id) ?? []);
  return {
    type: "FeatureCollection",
    features: region?.profiles
      .filter((item) => !latestProfileIds.has(item.latest_profile_id))
      .map((item) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [item.longitude, item.latitude] },
        properties: {
          platform: item.platform,
          cycle: item.cycle,
          profileId: item.latest_profile_id,
          timestamp: item.timestamp,
          hasBGC: item.has_bgc,
        },
      })) ?? [],
  };
}

function toArgoFleetGeoJSON(
  region: ArgoRegionSnapshot | null,
  coverage: ArgoEventCoverage | null,
): GeoJSON.FeatureCollection {
  const candidates = new Set(coverage?.candidates.map((item) => item.platform) ?? []);
  return {
    type: "FeatureCollection",
    features: region?.floats.map((item) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [item.longitude, item.latitude] },
      properties: {
        platform: item.platform,
        cycle: item.cycle,
        hasBGC: item.has_bgc,
        candidate: candidates.has(item.platform),
      },
    })) ?? [],
  };
}

function toProbeGeoJSON(point: [number, number] | null, selection: ArgoPointSelection | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (point) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: point },
      properties: { kind: "query" },
    });
  }
  if (point && selection) {
    const selectedCandidate = selection.candidates.find(
      (candidate) => candidate.platform === selection.selected_platform,
    );
    const nearest: [number, number] = selectedCandidate
      ? [selectedCandidate.longitude, selectedCandidate.latitude]
      : [selection.snapshot.latest.longitude, selection.snapshot.latest.latitude];
    features.push(
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [point, nearest] },
        properties: { kind: "connection" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: nearest },
        properties: { kind: "nearest", platform: selection.selected_platform },
      },
    );
  }
  return { type: "FeatureCollection", features };
}

const normalizeLongitude = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
const longitudeLabel = (value: number) => `${Math.abs(normalizeLongitude(value)).toFixed(5)}° ${normalizeLongitude(value) >= 0 ? "E" : "W"}`;
const latitudeLabel = (value: number) => `${Math.abs(value).toFixed(5)}° ${value >= 0 ? "N" : "S"}`;
const probeLongitudeLabel = (value: number) => `${Math.abs(normalizeLongitude(value)).toFixed(6)}° ${normalizeLongitude(value) >= 0 ? "E" : "W"}`;
const probeLatitudeLabel = (value: number) => `${Math.abs(value).toFixed(6)}° ${value >= 0 ? "N" : "S"}`;
const preciseCoordinateLabel = (longitude: number, latitude: number) => (
  `${probeLatitudeLabel(latitude)} · ${probeLongitudeLabel(longitude)}`
);

function groundResolutionLabel(zoom: number, latitude: number) {
  const metersPerPixel = 156543.03392 * Math.cos(latitude * Math.PI / 180) / 2 ** zoom;
  if (metersPerPixel >= 1000) return `${(metersPerPixel / 1000).toFixed(metersPerPixel >= 10_000 ? 0 : 1)} km/px`;
  if (metersPerPixel >= 10) return `${metersPerPixel.toFixed(0)} m/px`;
  if (metersPerPixel >= 1) return `${metersPerPixel.toFixed(1)} m/px`;
  return `${metersPerPixel.toFixed(2)} m/px`;
}

interface ProbeSstReading {
  point: SstGridPoint;
  distanceKm: number;
}

function greatCircleDistanceKm(first: [number, number], second: [number, number]) {
  const toRadians = Math.PI / 180;
  const latitudeA = first[1] * toRadians;
  const latitudeB = second[1] * toRadians;
  const deltaLatitude = (second[1] - first[1]) * toRadians;
  const deltaLongitude = normalizeLongitude(second[0] - first[0]) * toRadians;
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

function nearestProbeSst(
  probePoint: [number, number] | null,
  summary: RegionalObservationSummary | null,
): ProbeSstReading | null {
  if (!probePoint || !summary?.sst_latest_points.length) return null;

  let nearest: ProbeSstReading | null = null;
  for (const point of summary.sst_latest_points) {
    if (!point.quality_valid || !Number.isFinite(point.temperature)) continue;
    const distanceKm = greatCircleDistanceKm(probePoint, [point.longitude, point.latitude]);
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { point, distanceKm };
  }
  if (!nearest) return null;

  // The map payload is a sampled view of NOAA's 0.05-degree native grid.
  // Reject distant cells so a coastal or out-of-region click cannot inherit an unrelated temperature.
  const latitudeStep = summary.sst_latitude_step_degrees ?? summary.sst_native_resolution_degrees;
  const longitudeStep = summary.sst_longitude_step_degrees ?? summary.sst_native_resolution_degrees;
  const latitudeKm = Math.max(latitudeStep, summary.sst_native_resolution_degrees) * 111.32;
  const longitudeKm = Math.max(longitudeStep, summary.sst_native_resolution_degrees)
    * 111.32 * Math.max(0.08, Math.cos(probePoint[1] * Math.PI / 180));
  const representativeRadiusKm = Math.max(12, Math.hypot(latitudeKm, longitudeKm) * 0.75);
  return nearest.distanceKm <= representativeRadiusKm ? nearest : null;
}

const PROBE_METRICS = [
  { key: "temperature", label: "温度", unit: "°C", digits: 2 },
  { key: "salinity", label: "盐度", unit: "PSU", digits: 3 },
  { key: "chla", label: "叶绿素 a", unit: "mg m⁻³", digits: 3 },
  { key: "nitrate", label: "硝酸盐", unit: "μmol kg⁻¹", digits: 2 },
] as const;

function ArgoProbeProfile({ snapshot }: { snapshot: ArgoFloatSnapshot }) {
  const points = snapshot.latest.points
    .filter((point) => point.pressure >= 0 && PROBE_METRICS.some((metric) => typeof point[metric.key] === "number"))
    .sort((left, right) => left.pressure - right.pressure);
  if (points.length === 0) return null;
  const selectedPoints = points.length <= 5
    ? points
    : [points[0], points[Math.floor(points.length * 0.25)], points[Math.floor(points.length * 0.5)], points[Math.floor(points.length * 0.75)], points[points.length - 1]]
      .filter((point, index, all) => all.findIndex((candidate) => candidate.pressure === point.pressure) === index);
  return (
    <section className="sea-probe-profile" aria-label="Argo 最新剖面采样">
      <header>
        <div><strong>Argo 最新剖面</strong><span>同一浮标、同一时次的垂向采样</span></div>
        <small>压力向下增大</small>
      </header>
      <div className="sea-probe-profile-table">
        <div className="sea-probe-profile-row heading"><span>压力</span>{PROBE_METRICS.map((metric) => <span key={metric.key}>{metric.label}</span>)}</div>
        {selectedPoints.map((point) => (
          <div className="sea-probe-profile-row" key={`${point.pressure}`}>
            <strong>{point.pressure.toFixed(1)}<small> dbar</small></strong>
            {PROBE_METRICS.map((metric) => {
              const value = point[metric.key];
              return <span key={metric.key}>{typeof value === "number" ? value.toFixed(metric.digits) : "--"}</span>;
            })}
          </div>
        ))}
      </div>
      <p>Argo 不是点击坐标的连续海表监测；上表仅展示最近浮标在最近一次剖面中的实测层位，不做空间插值。</p>
    </section>
  );
}

const PROBE_PANEL_WIDTH = 392;
const PROBE_DOCK_MIN_WIDTH = 760;
const PROBE_DOCK_EDGE_PX = 72;

const MARINE_NAME_ZH: Record<string, string> = {
  "south china sea": "\u5357\u6d77",
  "east china sea": "\u4e1c\u6d77",
  "yellow sea": "\u9ec4\u6d77",
  "bohai sea": "\u6e24\u6d77",
  bohai: "\u6e24\u6d77",
  "philippine sea": "\u83f2\u5f8b\u5bbe\u6d77",
  "bay of bengal": "\u5b5f\u52a0\u62c9\u6e7e",
  "arabian sea": "\u963f\u62c9\u4f2f\u6d77",
  "sea of japan": "\u65e5\u672c\u6d77",
  "coral sea": "\u73ca\u745a\u6d77",
  "tasman sea": "\u5854\u65af\u66fc\u6d77",
  "pacific ocean": "\u592a\u5e73\u6d0b",
  "indian ocean": "\u5370\u5ea6\u6d0b",
  "atlantic ocean": "\u5927\u897f\u6d0b",
  "gulf of mexico": "\u58a8\u897f\u54e5\u6e7e",
  "mexico gulf": "\u58a8\u897f\u54e5\u6e7e",
  "gulf of america": "\u58a8\u897f\u54e5\u6e7e",
  "gulf of thailand": "\u6cf0\u56fd\u6e7e",
  "gulf of tonkin": "\u5317\u90e8\u6e7e",
  "taiwan strait": "\u4e2d\u56fd\u53f0\u6e7e\u6d77\u5ce1",
  "luzon strait": "\u5415\u5b8b\u6d77\u5ce1",
  "sulu sea": "\u82cf\u7984\u6d77",
  "celebes sea": "\u82cf\u62c9\u5a01\u897f\u6d77",
  "java sea": "\u722a\u54c7\u6d77",
  "andaman sea": "\u5b89\u8fbe\u66fc\u6d77",
  "sea of okhotsk": "\u9102\u970d\u6b21\u514b\u6d77",
  "arctic ocean": "\u5317\u51b0\u6d0b",
  "southern ocean": "\u5357\u5927\u6d0b",
};

function marineSeaTitle(context: MarineContext) {
  const genericNames = new Set(["海洋区域", "洋区", "海域", "Ocean region"]);
  const localName = context.sea_name.trim();
  if (localName && !genericNames.has(localName)) return localName;
  const englishName = context.sea_name_en.trim();
  const mappedName = MARINE_NAME_ZH[englishName.toLowerCase()];
  if (mappedName) return mappedName;
  const regionalName = context.fao_area.name.trim();
  if (regionalName && !genericNames.has(regionalName)) return regionalName;
  return localName || "未识别海域";
}

function fisheryDisplayName(resource: FisheryResource) {
  const chineseName = resource.chinese_name?.trim();
  if (chineseName && chineseName !== "鱼类/贝类/甲壳类等渔业相关类群") return chineseName;
  return resource.scientific_name;
}

function fisheryYearRange(resource: FisheryResource) {
  if (resource.first_year && resource.latest_year && resource.first_year !== resource.latest_year) {
    return `${resource.first_year}–${resource.latest_year}`;
  }
  return resource.latest_year ? String(resource.latest_year) : "年份未标注";
}

function formatDepth(value: number) {
  return Math.round(value).toLocaleString("zh-CN");
}

function formatDataLatency(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "--";
  const totalSeconds = Math.max(0, Math.round(seconds));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return [
    days ? `${days}天` : "",
    days || hours ? `${hours}小时` : "",
    days || hours || minutes ? `${minutes}分` : "",
    `${remainingSeconds}秒`,
  ].filter(Boolean).join(" ");
}

function SurfaceClassificationCard({ state }: { state: ProbeSurfaceState }) {
  if (state !== "land" && state !== "unresolved") return null;
  const isLand = state === "land";
  return (
    <section
      className={`sea-probe-surface-status ${state}`}
      data-testid={isLand ? "land-classification" : "unresolved-surface-classification"}
      role="status"
    >
      <span className="sea-probe-surface-icon">{isLand ? <Mountain size={17} /> : <Crosshair size={17} />}</span>
      <div>
        <span>海陆判定</span>
        <strong>{isLand ? "陆地点位" : "海陆状态未确认"}</strong>
        <small>
          {isLand
            ? "该坐标已由地形格网判定为陆地，海域、海温、渔业、Argo 与海洋百科信息均不显示。"
            : "地形数据没有完成海陆判定。为避免把陆地误标为海洋，本次不显示海洋信息。"}
        </small>
      </div>
    </section>
  );
}

function BathymetryCard({
  profile,
  loading,
  error,
}: {
  profile: BathymetryProfile | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !profile) {
    return (
      <section className="sea-probe-depth loading" aria-label="正在判定海陆并读取地形" aria-busy="true">
        <span className="sea-probe-depth-icon"><ArrowDownToLine size={16} /></span>
        <div><strong>正在判定海洋或陆地</strong><small>读取所选坐标地形格网</small></div>
      </section>
    );
  }
  if (!profile) {
    return error ? (
      <section className="sea-probe-depth error" role="status">
        <span className="sea-probe-depth-icon"><ArrowDownToLine size={16} /></span>
        <div><strong>海陆判定暂不可用</strong><small>{error}</small></div>
      </section>
    ) : null;
  }

  const markerPosition = Math.min(100, Math.max(0, profile.water_depth_m / 11_000 * 100));
  const primaryLabel = profile.is_ocean ? "所选坐标海底水深估算" : "所选坐标地表高程估算";
  const hasMicroRelief = profile.is_ocean
    && profile.micro_radius_m != null
    && profile.micro_shallowest_depth_m != null
    && profile.micro_deepest_depth_m != null
    && profile.micro_relief_m != null;
  return (
    <section
      className={`sea-probe-depth ${profile.is_ocean ? "ocean" : "land"}`}
      aria-label={profile.is_ocean ? "所选点海底深度" : "所选点地表高程"}
      data-testid="selected-bathymetry"
    >
      <header>
        <span className="sea-probe-depth-icon">{profile.is_ocean ? <ArrowDownToLine size={16} /> : <Mountain size={16} />}</span>
        <div>
          <span>{primaryLabel}</span>
          <strong>
            {profile.is_ocean ? formatDepth(profile.water_depth_m) : formatDepth(profile.seafloor_elevation_m)}
            <small> m</small>
          </strong>
        </div>
        <b className={profile.depth_zone}>{profile.depth_zone_name}</b>
      </header>
      {profile.is_ocean && (
        <>
          <div className="sea-probe-depth-scale" aria-hidden="true">
            <i style={{ left: `${markerPosition}%` }} />
          </div>
          <div className="sea-probe-depth-scale-labels"><span>海平面</span><span>6,000 m</span><span>11,000 m</span></div>
        </>
      )}
      <div className="sea-probe-depth-precision" data-testid="bathymetry-precision">
        <div className="sea-probe-depth-precision-heading">
          <span>点击坐标格网值 {longitudeLabel(profile.query_point.longitude)} / {latitudeLabel(profile.query_point.latitude)}</span>
          <b className={profile.confidence}>{profile.confidence_name}可信</b>
        </div>
        <div className="sea-probe-depth-precision-meta">
          <span>{profile.horizontal_resolution_m != null ? `约 ${profile.horizontal_resolution_m.toFixed(0)} m 格网` : "源服务未返回格网间距"}</span>
          <span>{profile.value_basis === "bilinear_grid_interpolation" ? "点击坐标双线性插值" : "点击坐标点服务估算"}</span>
          <span>{profile.high_resolution_coverage ? "高分辨率测线覆盖" : "全球地形模型"}</span>
        </div>
        {profile.verification_provider && profile.source_difference_m != null && (
          <div className="sea-probe-depth-verify">
            <span>{profile.verification_provider} 交叉核验</span>
            <b>
              {profile.is_ocean
                ? `${formatDepth(profile.verification_depth_m ?? 0)} m 水深`
                : `${formatDepth(profile.verification_elevation_m ?? 0)} m 高程`}
            </b>
            <em>源间差 {formatDepth(profile.source_difference_m)} m</em>
          </div>
        )}
        <small>{profile.confidence_note}</small>
      </div>
      <div className="sea-probe-depth-facts">
        {hasMicroRelief ? (
          <>
            <div><span>{profile.micro_radius_m?.toFixed(0)} m 内最浅</span><b>{formatDepth(profile.micro_shallowest_depth_m ?? 0)} m</b></div>
            <div><span>{profile.micro_radius_m?.toFixed(0)} m 内最深</span><b>{formatDepth(profile.micro_deepest_depth_m ?? 0)} m</b></div>
            <div><span>{profile.micro_radius_m?.toFixed(0)} m 内起伏</span><b>{formatDepth(profile.micro_relief_m ?? 0)} m</b></div>
          </>
        ) : (
          <>
            <div><span>查询半径</span><b>{profile.query_radius_m.toFixed(0)} m</b></div>
            <div><span>格网间距</span><b>{profile.horizontal_resolution_m != null ? `${profile.horizontal_resolution_m.toFixed(0)} m` : "未返回"}</b></div>
            <div><span>源间差</span><b>{profile.source_difference_m != null ? `${formatDepth(profile.source_difference_m)} m` : "未校验"}</b></div>
          </>
        )}
      </div>
      <p>{profile.explanation}</p>
      <footer>
        <span>点击坐标格网估算 · 查询半径 {profile.query_radius_m.toFixed(0)} m · {profile.is_ocean ? "海床" : "地表"}高程 {profile.seafloor_elevation_m.toFixed(0)} m</span>
        <a href={profile.source_url} target="_blank" rel="noreferrer">{profile.provider}<ExternalLink size={10} /></a>
      </footer>
    </section>
  );
}

function MarineContextCard({ context }: { context: import("../types").MarineContext }) {
  const seaTitle = marineSeaTitle(context);
  const [resourcesExpanded, setResourcesExpanded] = useState(false);
  const visibleResources = resourcesExpanded ? context.fisheries : context.fisheries.slice(0, 4);
  const hiddenResourceCount = Math.max(0, context.fisheries.length - visibleResources.length);
  return (
    <section className="marine-context-card marine-context-live" aria-label="点位海域与渔业资源">
      <header>
        <div>
          <span className="marine-context-eyebrow"><Crosshair size={11} /> 点击点位所属海域</span>
          <strong>{seaTitle}</strong>
          <small>{context.sea_name_en || context.place_type} · FAO {context.fao_area.code} {context.fao_area.name}</small>
        </div>
        <b className={`context-confidence ${context.confidence}`}>
          {context.confidence === "high" ? "标准地名" : context.confidence === "medium" ? "区域匹配" : "洋区参考"}
        </b>
      </header>
      {context.region_codes.length > 0 && (
        <div className="marine-context-codes" title={context.region_label || context.region_codes.join(" · ")}>
          <span>海域编码</span>
          <b>{context.region_codes.join(" · ")}</b>
        </div>
      )}
      <div className="marine-context-facts">
        <div><span>物种</span><b>{context.fisheries_species_count.toLocaleString("zh-CN")}</b><small>精确匹配</small></div>
        <div><span>记录</span><b>{context.fisheries_total_records.toLocaleString("zh-CN")}</b><small>OBIS 出现</small></div>
        <div><span>检索半径</span><b>{context.fisheries_search_radius_km.toFixed(0)}</b><small>千米</small></div>
        <div><span>扫描</span><b>{context.fisheries_scanned_records.toLocaleString("zh-CN")}/{context.biodiversity_total_records.toLocaleString("zh-CN")}</b><small>{context.fisheries_results_complete ? "完整" : "达上限"}</small></div>
      </div>
      <div className="marine-context-resources">
        <div className="marine-context-section-title">
          <span><Fish size={13} /> 附近有记录的具体物种</span>
          <small>{context.fisheries.length}/{context.fisheries_species_count} 种</small>
        </div>
        {context.fisheries.length ? <div className="marine-resource-list">
          {visibleResources.map((resource) => (
            <a key={resource.scientific_name} className="marine-resource-row" href={resource.worms_source_url ?? resource.source_url} target="_blank" rel="noreferrer" title="打开 WoRMS 物种权威记录">
              <span className="marine-resource-dot" />
              <div className="marine-resource-copy">
                <strong>{fisheryDisplayName(resource)}</strong>
                {!resource.chinese_name && <small className="marine-resource-name-note">权威中文名未收录，显示接受学名</small>}
                {resource.chinese_name && <em>{resource.scientific_name}{resource.scientific_name_authorship ? ` ${resource.scientific_name_authorship}` : ""}</em>}
                <small>{resource.family ?? "科未标注"} · {resource.taxon_order ?? "目未标注"}</small>
                <span className="marine-resource-evidence">
                  {resource.chinese_name_source && <i className="name-source">中文名：{resource.chinese_name_source.split(" · ")[0]}</i>}
                  {resource.fao_alpha3_code && <i>FAO {resource.fao_alpha3_code}</i>}
                  <i className={resource.fao_fishstat_data ? "fishstat" : "asfis"}>{resource.fao_fishstat_data ? "FAO FishStat 有统计数据" : `FAO ASFIS ${resource.fao_asfis_version}`}</i>
                  <i>OBIS {resource.evidence_count} 条</i>
                  <i>{resource.dataset_count} 个数据集</i>
                  <i>{fisheryYearRange(resource)}</i>
                </span>
              </div>
              <b><span>最近</span>{resource.minimum_distance_km.toFixed(1)} km<ExternalLink size={11} /></b>
            </a>
          ))}
        </div> : <p className="marine-context-empty">100 km 内未找到同时通过物种级、FAO ASFIS 与 OBIS 分布证据校验的记录。</p>}
        {context.fisheries.length > 4 && (
          <button type="button" className="marine-resource-expand" onClick={() => setResourcesExpanded((current) => !current)} aria-expanded={resourcesExpanded}>
            <span>{resourcesExpanded ? "收起物种列表" : `查看其余 ${hiddenResourceCount} 个物种`}</span>
            {resourcesExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>
      <p className="marine-context-caveat">{context.caveats[0]}</p>
      <footer className="marine-context-sources">
        <a href={context.fisheries_asfis_source_url} target="_blank" rel="noreferrer">FAO ASFIS {context.fisheries_asfis_version}<ExternalLink size={10} /></a>
        <a href={context.fisheries_source_url} target="_blank" rel="noreferrer">OBIS 出现记录<ExternalLink size={10} /></a>
      </footer>
    </section>
  );
}

function pointSpeciesEvidence(context?: MarineContext) {
  if (!context) return [];
  if (!context.fisheries.length) return [];
  return context.fisheries.slice(0, 5).map((resource) => {
    const displayName = fisheryDisplayName(resource);
    const taxonName = displayName === resource.scientific_name
      ? resource.scientific_name
      : `${displayName}（${resource.scientific_name}）`;
    return `${taxonName}：OBIS ${resource.evidence_count} 条出现记录，最近 ${resource.minimum_distance_km.toFixed(1)} km，记录期 ${fisheryYearRange(resource)}；FAO ASFIS ${resource.fao_asfis_version}。`;
  });
}

function MarineKnowledgeCard({ knowledge, context }: { knowledge: MarineKnowledge; context?: MarineContext }) {
  // Old server caches may still contain generated atlas prose. Requiring a
  // traceable article here prevents those fields from ever reaching the UI.
  if (knowledge.embedded === false || !knowledge.encyclopedia) return null;
  const speciesEvidence = pointSpeciesEvidence(context);
  return (
    <section className="marine-knowledge-card" aria-label="海域人文与历史知识">
      <header className="marine-knowledge-header">
        <div>
          <span className="marine-context-eyebrow"><BookOpen size={13} /> 海域知识 / 点击点位</span>
          <strong>{knowledge.display_name}</strong>
          <small className="marine-atlas-count">内置海域图录 {Number(knowledge.atlas_count || 0).toLocaleString("zh-CN")} 条 · {knowledge.atlas_version || "离线目录"}</small>
          <small>{knowledge.place_type} · {knowledge.parent_ocean ? `所属海洋 ${knowledge.parent_ocean} · ` : ""}FAO {knowledge.fao_area.name}（{knowledge.fao_area.code}）</small>
        </div>
        <span className="knowledge-curated">{knowledge.encyclopedia.source_name}简介</span>
      </header>
      <section className="marine-encyclopedia-article" aria-label="内置百科正文">
          <header>
            <div>
              <span>{knowledge.encyclopedia.source_name === "百度百科" ? "百度百科词条简介" : knowledge.encyclopedia.content_scope === "full" ? "内置百科完整正文" : knowledge.encyclopedia.content_scope === "translated_section" ? "维基百科专题章节简体中文译文" : knowledge.encyclopedia.original_language === "en" ? "维基百科简体中文译文" : "内置百科条目导言"}</span>
              <strong>{knowledge.encyclopedia.title}</strong>
            </div>
            <small>{knowledge.encyclopedia.source_name === "百度百科" ? `词条 ID #${knowledge.encyclopedia.page_id.toLocaleString("zh-CN")}` : `页面修订 #${knowledge.encyclopedia.revision_id.toLocaleString("zh-CN")}`}</small>
          </header>
          <div className="marine-encyclopedia-body">
            {(knowledge.encyclopedia.paragraphs.length
              ? knowledge.encyclopedia.paragraphs.slice(0, 8)
              : [knowledge.encyclopedia.extract]
            ).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
          {knowledge.encyclopedia.paragraphs.length > 8 && (
            <details>
              <summary>继续阅读完整快照 <ChevronDown size={13} /></summary>
              <div className="marine-encyclopedia-body">
                {knowledge.encyclopedia.paragraphs.slice(8).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </details>
          )}
          <footer>
            <span>{knowledge.encyclopedia.source_name} · {knowledge.encyclopedia.license}</span>
            {knowledge.encyclopedia.source_title && <span>原条目：{knowledge.encyclopedia.source_title}</span>}
            <span>快照 {formatDateTime(knowledge.encyclopedia.snapshot_at)}</span>
            <a href={knowledge.encyclopedia.url} target="_blank" rel="noreferrer">查看原始条目 <ExternalLink size={11} /></a>
          </footer>
      </section>
      {speciesEvidence.length > 0 && (
        <div className="marine-knowledge-grid">
          <article>
            <h4><Anchor size={14} />点位物种证据</h4>
            <ul>{speciesEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
        </div>
      )}
      <footer className="marine-knowledge-footer">
        <span>{knowledge.provider} · 更新于 {formatDateTime(knowledge.retrieved_at)}</span>
      </footer>
    </section>
  );
}

export const OceanMap = memo(function OceanMap({ events, selectedId, onSelect, onSelectArgoPlatform, focusArgoPlatform, argo, argoRegion, argoCoverage, observations, region, mode = "explorer", lightOcean = false, loading = false }: OceanMapProps) {
  const mapShellRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const mapCoordinateReadoutRef = useRef<HTMLElement>(null);
  const mapResolutionReadoutRef = useRef<HTMLSpanElement>(null);
  const mapHoverCoordinateRef = useRef<[number, number] | null>(null);
  const probePointRef = useRef<[number, number] | null>(null);
  const probePanelRef = useRef<HTMLElement>(null);
  const probeDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const onSelectRef = useRef(onSelect);
  const onSelectArgoRef = useRef(onSelectArgoPlatform);
  const eventsRef = useRef(events);
  const selectedIdRef = useRef(selectedId);
  const selectedEventStateRef = useRef<string | null>(null);
  const argoRef = useRef(argo);
  const argoRegionRef = useRef(argoRegion);
  const argoCoverageRef = useRef(argoCoverage);
  const observationsRef = useRef(observations);
  const argoMarkerRef = useRef<maplibregl.Marker | null>(null);
  const sstPopupRef = useRef<maplibregl.Popup | null>(null);
  const clusterPopupRef = useRef<maplibregl.Popup | null>(null);
  const clusterLabelMarkersRef = useRef<globalThis.Map<number, maplibregl.Marker>>(new globalThis.Map());
  const clusterClickHandledRef = useRef(false);
  const initialSelectionRef = useRef(false);
  const onProbeRef = useRef<(longitude: number, latitude: number, platform?: string, openDetails?: boolean) => void>(() => undefined);
  const probeAbortRef = useRef<AbortController | null>(null);
  const floatEnrichmentAbortRef = useRef<AbortController | null>(null);
  const probeOpenDetailsRef = useRef(false);
  const probeNoticeTimerRef = useRef<number | null>(null);
  const [layerCardCollapsed, setLayerCardCollapsed] = usePersistentState("ocean-ui-layer-card-collapsed", false);
  const [probePoint, setProbePoint] = useState<[number, number] | null>(null);
  const [probeSelection, setProbeSelection] = useState<ArgoPointSelection | null>(null);
  const [probeContext, setProbeContext] = useState<MarineContext | null>(null);
  const [probeKnowledge, setProbeKnowledge] = useState<MarineKnowledge | null>(null);
  const [probeBathymetry, setProbeBathymetry] = useState<BathymetryProfile | null>(null);
  const [probeSurface, setProbeSurface] = useState<ProbeSurfaceState>("idle");
  const [probeBathymetryLoading, setProbeBathymetryLoading] = useState(false);
  const [probeBathymetryError, setProbeBathymetryError] = useState<string | null>(null);
  const [copernicusWave, setCopernicusWave] = useState<CopernicusWavePoint | null>(null);
  const [copernicusWind, setCopernicusWind] = useState<CopernicusWindPoint | null>(null);
  const [copernicusLoading, setCopernicusLoading] = useState(false);
  const [copernicusHistoryOpen, setCopernicusHistoryOpen] = useState(false);
  const [copernicusHistoryLoading, setCopernicusHistoryLoading] = useState(false);
  const [copernicusHistoryError, setCopernicusHistoryError] = useState<string | null>(null);
  const [copernicusWaveHistory, setCopernicusWaveHistory] = useState<CopernicusHistoryPage | null>(null);
  const [copernicusWindHistory, setCopernicusWindHistory] = useState<CopernicusHistoryPage | null>(null);
  const [probeKnowledgeLoading, setProbeKnowledgeLoading] = useState(false);
  const [floatContext, setFloatContext] = useState<MarineContext | null>(null);
  const [floatKnowledge, setFloatKnowledge] = useState<MarineKnowledge | null>(null);
  const [floatEnrichmentLoading, setFloatEnrichmentLoading] = useState(false);
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeNotice, setProbeNotice] = useState<string | null>(null);
  const [probeDetailsOpen, setProbeDetailsOpen] = useState(false);
  const [probePanelCollapsed, setProbePanelCollapsed] = useState(false);
  const [probePanelDocked, setProbePanelDocked] = useState(false);
  const [probePanelPosition, setProbePanelPosition] = useState<{ x: number; y: number } | null>(null);
  const probeSstReading = useMemo(() => nearestProbeSst(probePoint, observations), [probePoint, observations]);
  const visibleProbeSstReading = probeSurface === "ocean" ? probeSstReading : null;
  const latestCopernicusWave = copernicusWave?.records.at(-1) ?? null;
  const latestCopernicusWind = copernicusWind?.records.at(-1) ?? null;
  const style = useMemo(buildStyle, []);

  const clampProbePanelPosition = useCallback((position: { x: number; y: number }) => {
    const shell = mapShellRef.current;
    const panel = probePanelRef.current;
    if (!shell || !panel) return position;
    const margin = 8;
    return {
      x: Math.min(Math.max(position.x, margin), Math.max(margin, shell.clientWidth - panel.offsetWidth - margin)),
      y: Math.min(Math.max(position.y, margin), Math.max(margin, shell.clientHeight - panel.offsetHeight - margin)),
    };
  }, []);

  const startProbeDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button, a")) return;
    const shell = mapShellRef.current;
    const panel = probePanelRef.current;
    if (!shell || !panel) return;
    const bounds = panel.getBoundingClientRect();
    const shellBounds = shell.getBoundingClientRect();
    const floatingWidth = Math.min(PROBE_PANEL_WIDTH, shell.clientWidth - 20);
    const offsetX = Math.min(event.clientX - bounds.left, floatingWidth - 20);
    const offsetY = event.clientY - bounds.top;
    if (probePanelDocked) {
      setProbePanelDocked(false);
      setProbePanelPosition(clampProbePanelPosition({
        x: event.clientX - shellBounds.left - offsetX,
        y: event.clientY - shellBounds.top - offsetY,
      }));
    }
    probeDragRef.current = {
      pointerId: event.pointerId,
      offsetX,
      offsetY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    panel.classList.add("dragging");
    event.preventDefault();
    event.stopPropagation();
  }, [clampProbePanelPosition, probePanelDocked]);

  const moveProbePanel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = probeDragRef.current;
    const shell = mapShellRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !shell) return;
    const bounds = shell.getBoundingClientRect();
    setProbePanelPosition(clampProbePanelPosition({
      x: event.clientX - bounds.left - drag.offsetX,
      y: event.clientY - bounds.top - drag.offsetY,
    }));
    event.preventDefault();
  }, [clampProbePanelPosition]);

  const stopProbeDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (probeDragRef.current?.pointerId !== event.pointerId) return;
    const shell = mapShellRef.current;
    if (shell) {
      const bounds = shell.getBoundingClientRect();
      const reachesDockEdge = shell.clientWidth >= PROBE_DOCK_MIN_WIDTH
        && bounds.right - event.clientX <= PROBE_DOCK_EDGE_PX;
      if (reachesDockEdge) {
        setProbePanelDocked(true);
        setProbePanelCollapsed(false);
        setProbePanelPosition(null);
      }
    }
    probeDragRef.current = null;
    probePanelRef.current?.classList.remove("dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const requestProbe = useCallback((
    longitude: number,
    latitude: number,
    platform?: string,
    forceRefresh = false,
    openDetails = false,
  ) => {
    const point: [number, number] = [Number(normalizeLongitude(longitude).toFixed(6)), Number(latitude.toFixed(6))];
    if (!platform) {
      const map = mapRef.current;
      const shell = mapShellRef.current;
      if (map && shell) {
        const projected = map.project(point);
        const panelWidth = Math.min(PROBE_PANEL_WIDTH, shell.clientWidth - 16);
        setProbePanelPosition({
          x: Math.max(8, projected.x > shell.clientWidth / 2 ? projected.x - panelWidth - 18 : projected.x + 18),
          y: Math.max(8, projected.y > shell.clientHeight / 2 ? projected.y - 260 : projected.y + 18),
        });
      }
    }
    probePointRef.current = point;
    mapHoverCoordinateRef.current = point;
    if (mapCoordinateReadoutRef.current) {
      mapCoordinateReadoutRef.current.textContent = preciseCoordinateLabel(point[0], point[1]);
    }
    probeAbortRef.current?.abort();
    const controller = new AbortController();
    probeAbortRef.current = controller;
    probeOpenDetailsRef.current = openDetails || probeDetailsOpen;
    setProbePoint(point);
    setProbeSurface("classifying");
    setProbeSelection(null);
    setProbeContext(null);
    setProbeKnowledge(null);
    setProbeBathymetry(null);
    setCopernicusWave(null);
    setCopernicusWind(null);
    setCopernicusHistoryOpen(false);
    setCopernicusHistoryError(null);
    setCopernicusWaveHistory(null);
    setCopernicusWindHistory(null);
    setProbeBathymetryLoading(true);
    setProbeBathymetryError(null);
    setProbeKnowledgeLoading(true);
    setProbeLoading(true);
    setProbeError(null);

    const isCurrentRequest = () => !controller.signal.aborted && probeAbortRef.current === controller;
    const bathymetryRequest: Promise<BathymetryProfile | null> = oceanApi
      .marineBathymetry(point[0], point[1], forceRefresh, controller.signal)
      .then((profile) => {
        if (!isCurrentRequest()) return null;
        setProbeBathymetry(profile);
        setProbeSurface(profile.is_ocean ? "ocean" : "land");
        if (!profile.is_ocean) {
          setProbeSelection(null);
          setProbeContext(null);
          setProbeKnowledge(null);
          setProbeDetailsOpen(false);
          setProbeLoading(false);
          setProbeKnowledgeLoading(false);
          setProbeError(null);
        }
        return profile;
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name === "AbortError" || !isCurrentRequest()) return null;
        setProbeSurface("unresolved");
        setProbeSelection(null);
        setProbeContext(null);
        setProbeKnowledge(null);
        setProbeDetailsOpen(false);
        setProbeLoading(false);
        setProbeKnowledgeLoading(false);
        setProbeError(null);
        setProbeBathymetryError(error instanceof Error ? error.message : "\u6d77\u9646\u5224\u5b9a\u6682\u65f6\u4e0d\u53ef\u7528");
        return null;
      })
      .finally(() => {
        if (isCurrentRequest()) setProbeBathymetryLoading(false);
      });

    const canShowMarineData = async () => {
      const profile = await bathymetryRequest;
      return Boolean(profile?.is_ocean && isCurrentRequest());
    };
    oceanApi.argoNearest(region.id, point[0], point[1], platform, forceRefresh, controller.signal, false)
      .then(async (selection) => {
        if (!(await canShowMarineData())) return;
        setProbeSelection(selection);
        if (selection.marine_context) setProbeContext(selection.marine_context);
        if (probeOpenDetailsRef.current) setProbeDetailsOpen(true);
      })
      .catch(async (error: unknown) => {
        if ((error as Error)?.name === "AbortError" || !isCurrentRequest()) return;
        if (!(await canShowMarineData())) return;
        setProbeError(error instanceof Error ? error.message : "Argo 数据暂时不可用");
      })
      .finally(() => {
        if (isCurrentRequest()) setProbeLoading(false);
      });

    // Place names and fisheries records depend on slower upstream services;
    // enrich the probe when they arrive without blocking its Argo profile.
    oceanApi.marineContext(point[0], point[1], forceRefresh, controller.signal)
      .then(async (context) => {
        if (await canShowMarineData()) setProbeContext(context);
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name === "AbortError") return;
        // Optional geographic context does not invalidate the Argo profile.
      });
    oceanApi.marineKnowledge(point[0], point[1], forceRefresh, controller.signal)
      .then(async (knowledge) => {
        if (await canShowMarineData()) setProbeKnowledge(knowledge);
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name === "AbortError") return;
      })
      .finally(() => {
        if (isCurrentRequest()) setProbeKnowledgeLoading(false);
      });
  }, [probeDetailsOpen, region.id]);

  const closeProbe = useCallback(() => {
    probeAbortRef.current?.abort();
    floatEnrichmentAbortRef.current?.abort();
    setProbeDetailsOpen(false);
    setProbePoint(null);
    probePointRef.current = null;
    mapHoverCoordinateRef.current = null;
    setProbeSelection(null);
    setProbeContext(null);
    setProbeKnowledge(null);
    setProbeBathymetry(null);
    setProbeSurface("idle");
    setProbeBathymetryLoading(false);
    setProbeBathymetryError(null);
    setProbeKnowledgeLoading(false);
    setFloatContext(null);
    setFloatKnowledge(null);
    setFloatEnrichmentLoading(false);
    setProbeError(null);
    setProbeLoading(false);
  }, []);

  useEffect(() => {
    floatEnrichmentAbortRef.current?.abort();
    if (!probeDetailsOpen || !probeSelection) {
      setFloatContext(null);
      setFloatKnowledge(null);
      setFloatEnrichmentLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    floatEnrichmentAbortRef.current = controller;
    const { longitude, latitude } = probeSelection.snapshot.latest;
    setFloatContext(null);
    setFloatKnowledge(null);
    setFloatEnrichmentLoading(true);

    void Promise.allSettled([
      oceanApi.marineContext(longitude, latitude, false, controller.signal),
      oceanApi.marineKnowledge(longitude, latitude, false, controller.signal),
    ]).then(([contextResult, knowledgeResult]) => {
      if (controller.signal.aborted || floatEnrichmentAbortRef.current !== controller) return;
      if (contextResult.status === "fulfilled") setFloatContext(contextResult.value);
      if (knowledgeResult.status === "fulfilled") setFloatKnowledge(knowledgeResult.value);
      setFloatEnrichmentLoading(false);
    });

    return () => controller.abort();
  }, [
    probeDetailsOpen,
    probeSelection?.selected_platform,
    probeSelection?.snapshot.latest.longitude,
    probeSelection?.snapshot.latest.latitude,
    probeSelection?.snapshot.fetched_at,
  ]);

  const syncArgoMarker = useCallback((map: Map, snapshot: ArgoFloatSnapshot | null) => {
    if (!snapshot?.latest) {
      argoMarkerRef.current?.remove();
      argoMarkerRef.current = null;
      return;
    }
    const coordinates: [number, number] = [snapshot.latest.longitude, snapshot.latest.latitude];
    if (!argoMarkerRef.current) {
      const marker = document.createElement("div");
      marker.className = "argo-float-marker";
      marker.setAttribute("role", "button");
      marker.setAttribute("tabindex", "0");
      marker.addEventListener("click", () => {
        const point = argoMarkerRef.current?.getLngLat();
        const platform = argoRef.current?.platform;
        if (point && platform) onProbeRef.current(point.lng, point.lat, platform, true);
      });
      marker.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const point = argoMarkerRef.current?.getLngLat();
        const platform = argoRef.current?.platform;
        if (point && platform) onProbeRef.current(point.lng, point.lat, platform, true);
      });
      argoMarkerRef.current = new maplibregl.Marker({ element: marker, anchor: "center" })
        .setLngLat(coordinates)
        .addTo(map);
    }
    const markerElement = argoMarkerRef.current.setLngLat(coordinates).getElement();
    markerElement.setAttribute("title", `Argo ${snapshot.platform} / Cycle ${snapshot.latest.cycle}`);
    markerElement.setAttribute("aria-label", `\u6253\u5f00 Argo ${snapshot.platform} \u8be6\u7ec6\u6570\u636e`);
  }, []);

  useEffect(() => {
    if (!probeDetailsOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProbeDetailsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [probeDetailsOpen]);

  const copyProbeCoordinates = useCallback(async () => {
    if (!probePoint) return;
    await navigator.clipboard.writeText(`${probePoint[1].toFixed(6)}, ${probePoint[0].toFixed(6)}`);
    setProbeNotice("坐标已复制");
    if (probeNoticeTimerRef.current) window.clearTimeout(probeNoticeTimerRef.current);
    probeNoticeTimerRef.current = window.setTimeout(() => setProbeNotice(null), 1600);
  }, [probePoint]);

  useEffect(() => {
    if (!probePoint || probeSurface !== "ocean") {
      setCopernicusWave(null);
      setCopernicusWind(null);
      setCopernicusLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setCopernicusWave(null);
    setCopernicusWind(null);
    setCopernicusLoading(true);
    Promise.allSettled([
      oceanApi.copernicusWavePoint(probePoint[0], probePoint[1], 1, controller.signal),
      oceanApi.copernicusWindPoint(probePoint[0], probePoint[1], 1, controller.signal),
    ]).then(([waveResult, windResult]) => {
      if (controller.signal.aborted) return;
      if (waveResult.status === "fulfilled") setCopernicusWave(waveResult.value);
      if (windResult.status === "fulfilled") setCopernicusWind(windResult.value);
      if (waveResult.status === "rejected" && (waveResult.reason as Error)?.name !== "AbortError") {
        setCopernicusWave(null);
      }
      if (windResult.status === "rejected" && (windResult.reason as Error)?.name !== "AbortError") {
        setCopernicusWind(null);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setCopernicusLoading(false);
    });
    return () => controller.abort();
  }, [probePoint, probeSurface]);

  const toggleCopernicusHistory = useCallback(() => {
    if (copernicusHistoryOpen) {
      setCopernicusHistoryOpen(false);
      return;
    }
    setCopernicusHistoryOpen(true);
    if (!probePoint || (copernicusWaveHistory && copernicusWindHistory)) return;
    setCopernicusHistoryLoading(true);
    setCopernicusHistoryError(null);
    Promise.all([
      oceanApi.copernicusHistoryPoint(probePoint[0], probePoint[1], "wave", { sync: true, limit: 200 }),
      oceanApi.copernicusHistoryPoint(probePoint[0], probePoint[1], "wind", { sync: true, limit: 200 }),
    ])
      .then(([wave, wind]) => {
        setCopernicusWaveHistory(wave);
        setCopernicusWindHistory(wind);
      })
      .catch((error: unknown) => setCopernicusHistoryError(error instanceof Error ? error.message : "历史数据同步失败"))
      .finally(() => setCopernicusHistoryLoading(false));
  }, [copernicusHistoryOpen, copernicusWaveHistory, copernicusWindHistory, probePoint]);

  const frameProbe = useCallback(() => {
    const map = mapRef.current;
    if (!map || !probePoint) return;
    if (!probeSelection) {
      map.flyTo({ center: probePoint, zoom: Math.max(map.getZoom(), 5), duration: 650 });
      return;
    }
    const latest = probeSelection.snapshot.latest;
    map.fitBounds(
      [
        [Math.min(probePoint[0], latest.longitude), Math.min(probePoint[1], latest.latitude)],
        [Math.max(probePoint[0], latest.longitude), Math.max(probePoint[1], latest.latitude)],
      ],
      { padding: 110, duration: 700, maxZoom: 6.5 },
    );
  }, [probePoint, probeSelection]);

  useEffect(() => {
    onProbeRef.current = (longitude, latitude, platform, openDetails) => requestProbe(longitude, latitude, platform, false, openDetails);
  }, [requestProbe]);

  useEffect(() => {
    probeAbortRef.current?.abort();
    setProbeDetailsOpen(false);
    setProbePoint(null);
    setProbeSelection(null);
    setProbeContext(null);
    setProbeKnowledge(null);
    setProbeBathymetry(null);
    setCopernicusWave(null);
    setCopernicusWind(null);
    setProbeSurface("idle");
    setProbeBathymetryLoading(false);
    setProbeBathymetryError(null);
    setProbeKnowledgeLoading(false);
    setProbeError(null);
  }, [region.id]);

  useEffect(() => {
    if (!probePoint) return undefined;
    const frame = window.requestAnimationFrame(() => {
      setProbePanelPosition((current) => clampProbePanelPosition(current ?? { x: 16, y: 116 }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [probePoint, probeSelection, clampProbePanelPosition]);

  useEffect(() => () => {
    probeAbortRef.current?.abort();
    if (probeNoticeTimerRef.current) window.clearTimeout(probeNoticeTimerRef.current);
  }, []);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onSelectArgoRef.current = onSelectArgoPlatform;
  }, [onSelect, onSelectArgoPlatform]);

  useEffect(() => {
    eventsRef.current = events;
    selectedIdRef.current = selectedId;
    argoRef.current = argo;
    argoRegionRef.current = argoRegion;
    argoCoverageRef.current = argoCoverage;
    observationsRef.current = observations;
  }, [events, selectedId, argo, argoRegion, argoCoverage, observations]);

  useEffect(() => {
    if (!focusArgoPlatform || !argoRegion || !mapRef.current) return;
    const buoy = argoRegion.floats.find((item) => item.platform === focusArgoPlatform);
    if (buoy) mapRef.current.flyTo({ center: [buoy.longitude, buoy.latitude], zoom: Math.max(mapRef.current.getZoom(), 4.2), duration: 900 });
  }, [argoRegion, focusArgoPlatform]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const mapContainer = containerRef.current;

    const map = new maplibregl.Map({
      container: mapContainer,
      style,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      // Keep a true basin/global view while still allowing point-level inspection.
      minZoom: 0.35,
      maxZoom: 21,
      renderWorldCopies: true,
      cooperativeGestures: false,
      attributionControl: false,
      locale: {
        "AttributionControl.ToggleAttribution": "切换地图来源",
        "Map.Title": "全球海洋观测地图",
        "Marker.Title": "地图标记",
        "NavigationControl.ResetBearing": "拖动旋转地图，单击恢复正北",
        "NavigationControl.ZoomIn": "放大地图",
        "NavigationControl.ZoomOut": "缩小地图",
        "Popup.Close": "关闭弹窗",
        "CooperativeGesturesHandler.WindowsHelpText": "按住 Ctrl 并滚动以缩放地图",
        "CooperativeGesturesHandler.MacHelpText": "按住 Command 并滚动以缩放地图",
        "CooperativeGesturesHandler.MobileHelpText": "使用双指移动地图",
      },
    });
    mapRef.current = map;
    map.dragPan.enable();
    map.scrollZoom.enable();
    map.touchZoomRotate.enable();
    map.doubleClickZoom.enable();
    const preventPageZoom = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const zoomDelta = event.deltaY < 0 ? 0.8 : -0.8;
      const nextZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + zoomDelta));
      map.easeTo({ zoom: nextZoom, duration: 160 });
    };
    const preventNativeGesture = (event: Event) => event.preventDefault();
    mapContainer.addEventListener("wheel", preventPageZoom, { capture: true, passive: false });
    mapContainer.addEventListener("gesturestart", preventNativeGesture, { passive: false });
    mapContainer.addEventListener("gesturechange", preventNativeGesture, { passive: false });
    mapContainer.addEventListener("gestureend", preventNativeGesture, { passive: false });
    let removeCountryLabels: () => void = () => undefined;
    let removeProvinceLabels: () => void = () => undefined;
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: "metric" }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    const updateMapReadout = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      if (mapCoordinateReadoutRef.current) {
        const coordinate = probePointRef.current ?? mapHoverCoordinateRef.current;
        mapCoordinateReadoutRef.current.textContent = preciseCoordinateLabel(
          coordinate?.[0] ?? center.lng,
          coordinate?.[1] ?? center.lat,
        );
      }
      if (mapResolutionReadoutRef.current) {
        mapResolutionReadoutRef.current.textContent = `Z${zoom.toFixed(1)} · ${groundResolutionLabel(zoom, center.lat)} · ${zoom >= 8 ? "街道" : "海洋"}`;
      }
    };
    updateMapReadout();
    map.on("move", updateMapReadout);
    const handleMapMouseMove = (event: MapMouseEvent) => {
      mapHoverCoordinateRef.current = [event.lngLat.lng, event.lngLat.lat];
      if (!probePointRef.current && mapCoordinateReadoutRef.current) {
        mapCoordinateReadoutRef.current.textContent = preciseCoordinateLabel(event.lngLat.lng, event.lngLat.lat);
      }
    };
    const handleMapMouseLeave = () => {
      mapHoverCoordinateRef.current = null;
      updateMapReadout();
    };
    map.on("mousemove", handleMapMouseMove);
    map.on("mouseleave", handleMapMouseLeave);

    const clearClusterLabels = () => {
      for (const marker of clusterLabelMarkersRef.current.values()) marker.remove();
      clusterLabelMarkersRef.current.clear();
    };
    const expandObservationCluster = (clusterId: number, coordinates: [number, number]) => {
      clusterPopupRef.current?.remove();
      clusterPopupRef.current = null;
      probeAbortRef.current?.abort();
      setProbePoint(null);
      setProbeSelection(null);
      setProbeContext(null);
      setProbeBathymetry(null);
      setProbeBathymetryLoading(false);
      setProbeBathymetryError(null);
      setProbeError(null);
      setProbeLoading(false);
      const source = map.getSource("argo-observations") as GeoJSONSource | undefined;
      void source?.getClusterExpansionZoom(clusterId).then((zoom) => {
        map.easeTo({ center: coordinates, zoom: Math.min(zoom, 8), duration: 620 });
      });
    };
    const syncClusterLabels = () => {
      if (!map.getLayer("argo-observation-clusters")) return;
      const visibleIds = new Set<number>();
      for (const feature of map.queryRenderedFeatures({ layers: ["argo-observation-clusters"] })) {
        if (feature.geometry.type !== "Point") continue;
        const clusterId = Number(feature.properties?.cluster_id);
        const count = Number(feature.properties?.point_count ?? 0);
        if (!Number.isFinite(clusterId) || count <= 0 || visibleIds.has(clusterId)) continue;
        visibleIds.add(clusterId);
        const label = count >= 10_000
          ? `${(count / 10_000).toFixed(count >= 100_000 ? 0 : 1)}万`
          : count >= 1_000
            ? `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}千`
            : count.toLocaleString("zh-CN");
        const existing = clusterLabelMarkersRef.current.get(clusterId);
        if (existing) {
          existing.setLngLat(feature.geometry.coordinates as [number, number]);
          const element = existing.getElement();
          element.textContent = label;
          element.dataset.clusterId = String(clusterId);
          element.dataset.longitude = String(feature.geometry.coordinates[0]);
          element.dataset.latitude = String(feature.geometry.coordinates[1]);
          element.setAttribute("title", `${count.toLocaleString("zh-CN")} 个历史剖面，点击展开`);
          element.setAttribute("aria-label", `${count.toLocaleString("zh-CN")} 个历史剖面，点击展开`);
          continue;
        }
        const element = document.createElement("span");
        element.className = "argo-cluster-count-label";
        element.textContent = label;
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        element.setAttribute("title", `${count.toLocaleString("zh-CN")} 个历史剖面，点击展开`);
        element.setAttribute("aria-label", `${count.toLocaleString("zh-CN")} 个历史剖面，点击展开`);
        const coordinates = feature.geometry.coordinates as [number, number];
        element.dataset.clusterId = String(clusterId);
        element.dataset.longitude = String(coordinates[0]);
        element.dataset.latitude = String(coordinates[1]);
        const expandFromLabel = () => {
          const currentClusterId = Number(element.dataset.clusterId);
          const longitude = Number(element.dataset.longitude);
          const latitude = Number(element.dataset.latitude);
          if (!Number.isFinite(currentClusterId) || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
          expandObservationCluster(currentClusterId, [longitude, latitude]);
        };
        element.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          expandFromLabel();
        });
        element.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          expandFromLabel();
        });
        const marker = new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(coordinates)
          .addTo(map);
        clusterLabelMarkersRef.current.set(clusterId, marker);
      }
      for (const [clusterId, marker] of clusterLabelMarkersRef.current) {
        if (visibleIds.has(clusterId)) continue;
        marker.remove();
        clusterLabelMarkersRef.current.delete(clusterId);
      }
    };
    let clusterLabelFrame: number | null = null;
    const scheduleClusterLabelSync = () => {
      if (clusterLabelFrame !== null) return;
      clusterLabelFrame = window.requestAnimationFrame(() => {
        clusterLabelFrame = null;
        syncClusterLabels();
      });
    };
    const handleClusterSourceData = (event: maplibregl.MapSourceDataEvent) => {
      if (event.sourceId === "argo-observations" && event.isSourceLoaded) scheduleClusterLabelSync();
    };
    map.on("idle", scheduleClusterLabelSync);
    map.on("moveend", scheduleClusterLabelSync);
    map.on("sourcedata", handleClusterSourceData);

    map.on("load", () => {
      void addProvinceLabels(map).then((cleanup) => {
        if (mapRef.current === map) removeProvinceLabels = cleanup;
        else cleanup();
      });
      void addCountryLabels(map).then((cleanup) => {
        if (mapRef.current === map) removeCountryLabels = cleanup;
        else cleanup();
      });
      map.addSource("sst-grid", {
        type: "geojson",
        data: toSstGridGeoJSON(observationsRef.current),
      });
      map.addLayer({
        id: "sst-grid-heat",
        type: "heatmap",
        source: "sst-grid",
        maxzoom: 5.5,
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "temperature"], -2, 0.12, 15, 0.38, 30, 0.9, 36, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0.8, 0.86, 5.5, 1.25],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0.8, 7, 5.5, 18],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0.8, 0.78, 5.5, 0.2],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(36, 92, 120, 0)",
            0.22, "rgba(66, 151, 162, 0.48)",
            0.48, "rgba(103, 202, 181, 0.65)",
            0.72, "rgba(238, 174, 92, 0.78)",
            1, "rgba(239, 93, 72, 0.9)",
          ],
        },
      });
      map.addLayer({
        id: "sst-grid-dots",
        type: "circle",
        source: "sst-grid",
        minzoom: 0.8,
        maxzoom: 2.4,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0.8, 0.72, 2.4, 1.35],
          "circle-color": [
            "interpolate", ["linear"], ["get", "temperature"],
            -2, "#7894d1", 8, "#68b7dc", 18, "#69d2c2", 26, "#ebcf68", 32, "#ef795d", 38, "#ce493e",
          ],
          "circle-opacity": 0,
        },
      });
      map.addLayer({
        id: "sst-grid-points",
        type: "circle",
        source: "sst-grid",
        minzoom: 1.65,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1.65, 1.05, 7, 3.8],
          "circle-color": [
            "interpolate", ["linear"], ["get", "temperature"],
            -2, "#7487c7", 8, "#58a7cf", 18, "#58c8b5", 26, "#dfc65e", 32, "#ef745b", 38, "#c8463d",
          ],
          "circle-opacity": 0,
          "circle-stroke-width": 0.25,
          "circle-stroke-color": "#102321",
        },
      });
      map.addLayer({
        id: "sst-grid-hit",
        type: "circle",
        source: "sst-grid",
        minzoom: 0.8,
        paint: { "circle-radius": 7, "circle-color": "#ffffff", "circle-opacity": 0 },
      });
      map.addSource("events", { type: "geojson", data: toGeoJSON(eventsRef.current) });
      map.addSource("event-selection", {
        type: "geojson",
        data: toSelectedEventGeoJSON(eventsRef.current, selectedIdRef.current),
      });
      map.addLayer({
        id: "event-halos",
        type: "circle",
        source: "events",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "severity"], 0, 14, 1, 34],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.16,
          "circle-stroke-width": 1,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-opacity": 0.45,
        },
      });
      map.addLayer({
        id: "event-points",
        type: "circle",
        source: "events",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "severity"], 0, 5, 1, 9],
          "circle-color": ["get", "color"],
          "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 4, 2],
          "circle-stroke-color": "#f1f1e9",
        },
      });
      map.addLayer({
        id: "event-selection",
        type: "circle",
        source: "event-selection",
        paint: {
          "circle-radius": 18,
          "circle-color": "#ffffff",
          "circle-opacity": 0,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ef5d48",
          "circle-stroke-opacity": 0.75,
        },
      });
      if (selectedIdRef.current) {
        map.setFeatureState({ source: "events", id: selectedIdRef.current }, { selected: true });
        selectedEventStateRef.current = selectedIdRef.current;
      }

      map.addSource("argo-observations", {
        type: "geojson",
        data: toArgoObservationGeoJSON(argoRegionRef.current),
        cluster: true,
        clusterMaxZoom: 4,
        clusterRadius: 42,
      });
      map.addLayer({
        id: "argo-observation-clusters",
        type: "circle",
        source: "argo-observations",
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": ["step", ["get", "point_count"], 14, 80, 17, 300, 21, 1_000, 26],
          "circle-color": ["step", ["get", "point_count"], "#3a9998", 80, "#2f8488", 300, "#286e79", 1_000, "#205a69"],
          "circle-opacity": 0.88,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#dff8f5",
          "circle-stroke-opacity": 0.88,
        },
      });
      map.addLayer({
        id: "argo-observation-points",
        type: "circle",
        source: "argo-observations",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 1.7, 5, 2.8, 8, 4],
          "circle-color": ["case", ["==", ["get", "hasBGC"], true], "#b9cf5b", "#4fb9b4"],
          "circle-opacity": 0.46,
          "circle-stroke-width": 0.4,
          "circle-stroke-color": "#102d2b",
        },
      });
      map.addLayer({
        id: "argo-observation-hit",
        type: "circle",
        source: "argo-observations",
        filter: ["!", ["has", "point_count"]],
        paint: { "circle-radius": 8, "circle-color": "#ffffff", "circle-opacity": 0 },
      });

      map.addSource("argo-fleet", {
        type: "geojson",
        data: toArgoFleetGeoJSON(argoRegionRef.current, argoCoverageRef.current),
      });
      if (!map.hasImage("bgc-float-diamond")) {
        map.addImage("bgc-float-diamond", createBgcDiamondImage(), { pixelRatio: 2 });
      }
      map.addLayer({
        id: "argo-fleet-candidate-halos",
        type: "circle",
        source: "argo-fleet",
        filter: ["==", ["get", "candidate"], true],
        paint: {
          "circle-radius": 10,
          "circle-color": "#f06b58",
          "circle-opacity": 0.08,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#f06b58",
          "circle-stroke-opacity": 0.82,
        },
      });
      map.addLayer({
        id: "argo-fleet-points",
        type: "circle",
        source: "argo-fleet",
        filter: ["any", ["==", ["get", "candidate"], true], ["!=", ["get", "hasBGC"], true]],
        paint: {
          "circle-radius": ["case", ["==", ["get", "candidate"], true], 5.8, ["==", ["get", "hasBGC"], true], 3.8, 2.8],
          "circle-color": ["case", ["==", ["get", "candidate"], true], "#f06b58", ["==", ["get", "hasBGC"], true], "#c6d96b", "#47b7b5"],
          "circle-opacity": ["case", ["==", ["get", "candidate"], true], 0.98, ["==", ["get", "hasBGC"], true], 0.74, 0.42],
          "circle-stroke-width": ["case", ["==", ["get", "candidate"], true], 2, ["==", ["get", "hasBGC"], true], 1, 0.45],
          "circle-stroke-color": ["case", ["==", ["get", "candidate"], true], "#fff8ee", ["==", ["get", "hasBGC"], true], "#334a2a", "#163633"],
        },
      });
      map.addLayer({
        id: "argo-fleet-bgc-symbols",
        type: "symbol",
        source: "argo-fleet",
        filter: ["all", ["==", ["get", "hasBGC"], true], ["!=", ["get", "candidate"], true]],
        layout: {
          "icon-image": "bgc-float-diamond",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 0.35, 0.56, 3, 0.7, 7, 1],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": 0.76 },
      });
      map.addLayer({
        id: "argo-fleet-hit",
        type: "circle",
        source: "argo-fleet",
        paint: { "circle-radius": 11, "circle-color": "#ffffff", "circle-opacity": 0 },
      });

      map.addSource("argo-track", { type: "geojson", lineMetrics: true, data: toArgoTrackGeoJSON(argoRef.current) });
      map.addLayer({
        id: "argo-track-glow",
        type: "line",
        source: "argo-track",
        paint: { "line-color": "#61c9c0", "line-width": 6, "line-opacity": 0.12, "line-blur": 2 },
      });
      map.addLayer({
        id: "argo-track-line",
        type: "line",
        source: "argo-track",
        paint: { "line-color": "#76d8c7", "line-width": 1.8, "line-opacity": 0.9, "line-dasharray": [1.2, 1.4] },
      });
      map.addSource("argo-latest", { type: "geojson", data: toArgoLatestGeoJSON(argoRef.current) });
      map.addLayer({
        id: "argo-latest-halo",
        type: "circle",
        source: "argo-latest",
        paint: { "circle-radius": 14, "circle-color": "#72d7c5", "circle-opacity": 0.13, "circle-stroke-color": "#b9f0df", "circle-stroke-width": 1.1 },
      });
      map.addLayer({
        id: "argo-latest-point",
        type: "circle",
        source: "argo-latest",
        paint: { "circle-radius": 5.4, "circle-color": "#7ddacb", "circle-stroke-color": "#102321", "circle-stroke-width": 2 },
      });
      map.addSource("sea-probe", { type: "geojson", data: toProbeGeoJSON(null, null) });
      map.addLayer({
        id: "sea-probe-connection",
        type: "line",
        source: "sea-probe",
        filter: ["==", ["get", "kind"], "connection"],
        paint: {
          "line-color": "#f4d17a",
          "line-width": 1.6,
          "line-opacity": 0.92,
          "line-dasharray": [1.5, 1.3],
        },
      });
      map.addLayer({
        id: "sea-probe-query-halo",
        type: "circle",
        source: "sea-probe",
        filter: ["==", ["get", "kind"], "query"],
        paint: {
          "circle-radius": 16,
          "circle-color": "#ef5d48",
          "circle-opacity": 0.12,
          "circle-stroke-color": "#ff8c78",
          "circle-stroke-width": 1.4,
        },
      });
      map.addLayer({
        id: "sea-probe-query-point",
        type: "circle",
        source: "sea-probe",
        filter: ["==", ["get", "kind"], "query"],
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#ff785f",
          "circle-stroke-color": "#fff7e5",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "sea-probe-nearest-halo",
        type: "circle",
        source: "sea-probe",
        filter: ["==", ["get", "kind"], "nearest"],
        paint: {
          "circle-radius": 13,
          "circle-color": "#72d7c5",
          "circle-opacity": 0.16,
          "circle-stroke-color": "#b9f0df",
          "circle-stroke-width": 1.2,
        },
      });
      map.addLayer({
        id: "sea-probe-nearest-point",
        type: "circle",
        source: "sea-probe",
        filter: ["==", ["get", "kind"], "nearest"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#79dcc9",
          "circle-stroke-color": "#102321",
          "circle-stroke-width": 2,
        },
      });
      const latest = argoRef.current?.latest;
      if (latest) {
        const marker = document.createElement("div");
        marker.className = "argo-float-marker";
        marker.setAttribute("role", "button");
        marker.setAttribute("tabindex", "0");
        marker.setAttribute("aria-label", `打开 Argo ${argoRef.current?.platform} 详细数据`);
        marker.setAttribute("title", `Argo ${argoRef.current?.platform} / Cycle ${latest.cycle}`);
        marker.addEventListener("click", () => {
          const point = argoMarkerRef.current?.getLngLat();
          const platform = argoRef.current?.platform;
          if (point && platform) onProbeRef.current(point.lng, point.lat, platform, true);
        });
        marker.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          const point = argoMarkerRef.current?.getLngLat();
          const platform = argoRef.current?.platform;
          if (point && platform) onProbeRef.current(point.lng, point.lat, platform, true);
        });
        argoMarkerRef.current = new maplibregl.Marker({ element: marker, anchor: "center" })
          .setLngLat([latest.longitude, latest.latitude])
          .addTo(map);
      }

      syncArgoMarker(map, argoRef.current);
      map.on("click", "event-points", (event) => {
        const id = event.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelectRef.current(id);
      });
      map.on("mouseenter", "event-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "event-points", () => { map.getCanvas().style.cursor = "crosshair"; });
      map.on("click", "sst-grid-hit", (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const temperature = Number(feature.properties?.temperature);
        const analysisError = feature.properties?.analysisError;
        const timestamp = String(feature.properties?.timestamp ?? "");
        const content = document.createElement("div");
        content.className = "sst-grid-popup";
        const heading = document.createElement("strong");
        heading.textContent = `海表温度 ${Number.isFinite(temperature) ? temperature.toFixed(2) : "--"} °C`;
        const detail = document.createElement("span");
        detail.textContent = `${timestamp ? formatDateTime(timestamp) : "时间未定义"}${analysisError != null ? ` · 分析误差 ${Number(analysisError).toFixed(2)} °C` : ""}`;
        content.append(heading, detail);
        sstPopupRef.current?.remove();
        sstPopupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 8 })
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setDOMContent(content)
          .addTo(map);
      });
      map.on("mouseenter", "sst-grid-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "sst-grid-hit", () => { map.getCanvas().style.cursor = "crosshair"; });
      const handleArgoClick = (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const platform = feature?.properties?.platform as string | undefined;
        if (platform) {
          const coordinates = feature?.geometry.type === "Point"
            ? feature.geometry.coordinates as [number, number]
            : [event.lngLat.lng, event.lngLat.lat] as [number, number];
          onSelectArgoRef.current(platform);
          onProbeRef.current(coordinates[0], coordinates[1], platform, true);
        }
      };
      map.on("click", "argo-observation-clusters", (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        clusterClickHandledRef.current = true;
        const clusterId = Number(feature.properties?.cluster_id);
        if (!Number.isFinite(clusterId)) return;
        const coordinates = [...feature.geometry.coordinates] as [number, number];
        while (Math.abs(event.lngLat.lng - coordinates[0]) > 180) {
          coordinates[0] += event.lngLat.lng > coordinates[0] ? 360 : -360;
        }
        expandObservationCluster(clusterId, coordinates);
      });
      map.on("mouseenter", "argo-observation-clusters", (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const coordinates = [...feature.geometry.coordinates] as [number, number];
        while (Math.abs(event.lngLat.lng - coordinates[0]) > 180) {
          coordinates[0] += event.lngLat.lng > coordinates[0] ? 360 : -360;
        }
        const count = Number(feature.properties?.point_count ?? 0);
        const content = document.createElement("div");
        content.className = "argo-cluster-popup";
        const heading = document.createElement("strong");
        heading.textContent = `${count.toLocaleString("zh-CN")} 个历史剖面`;
        const detail = document.createElement("span");
        detail.textContent = "点击放大并展开点位";
        content.append(heading, detail);
        clusterPopupRef.current?.remove();
        clusterPopupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 })
          .setLngLat(coordinates)
          .setDOMContent(content)
          .addTo(map);
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "argo-observation-clusters", () => {
        clusterPopupRef.current?.remove();
        clusterPopupRef.current = null;
        map.getCanvas().style.cursor = "crosshair";
      });
      map.on("click", "argo-observation-hit", handleArgoClick);
      map.on("click", "argo-fleet-hit", handleArgoClick);
      map.on("click", "argo-latest-point", (event) => {
        const feature = event.features?.[0];
        const platform = feature?.properties?.platform as string | undefined;
        const coordinates = feature?.geometry.type === "Point"
          ? feature.geometry.coordinates as [number, number]
          : [event.lngLat.lng, event.lngLat.lat] as [number, number];
        if (platform) onProbeRef.current(coordinates[0], coordinates[1], platform, true);
      });
      map.on("mouseenter", "argo-fleet-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "argo-fleet-points", () => { map.getCanvas().style.cursor = "crosshair"; });
      map.on("mouseenter", "argo-observation-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "argo-observation-hit", () => { map.getCanvas().style.cursor = "crosshair"; });
      map.on("mouseenter", "argo-fleet-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "argo-fleet-hit", () => { map.getCanvas().style.cursor = "crosshair"; });
      map.on("mouseenter", "argo-latest-point", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "argo-latest-point", () => { map.getCanvas().style.cursor = "crosshair"; });
      map.on("click", (event) => {
        const interactiveHits = map.queryRenderedFeatures(event.point, {
          // SST cells can show temperature and still open the sea probe.
          // Only entity selections take ownership of the click.
          layers: ["event-points", "argo-observation-clusters", "argo-observation-points", "argo-observation-hit", "argo-fleet-points", "argo-fleet-hit", "argo-latest-point"],
        });
        const longitude = event.lngLat.lng;
        const latitude = event.lngLat.lat;
        window.setTimeout(() => {
          if (clusterClickHandledRef.current) {
            clusterClickHandledRef.current = false;
            return;
          }
          if (interactiveHits.length === 0) onProbeRef.current(longitude, latitude);
        }, 0);
      });
      map.getCanvas().style.cursor = "crosshair";
    });

    return () => {
      mapContainer.removeEventListener("wheel", preventPageZoom, true);
      mapContainer.removeEventListener("gesturestart", preventNativeGesture);
      mapContainer.removeEventListener("gesturechange", preventNativeGesture);
      mapContainer.removeEventListener("gestureend", preventNativeGesture);
      resizeObserver.disconnect();
      map.off("move", updateMapReadout);
      map.off("mousemove", handleMapMouseMove);
      map.off("mouseleave", handleMapMouseLeave);
      removeCountryLabels();
      removeProvinceLabels();
      sstPopupRef.current?.remove();
      sstPopupRef.current = null;
      clusterPopupRef.current?.remove();
      clusterPopupRef.current = null;
      map.off("idle", scheduleClusterLabelSync);
      map.off("moveend", scheduleClusterLabelSync);
      map.off("sourcedata", handleClusterSourceData);
      if (clusterLabelFrame !== null) window.cancelAnimationFrame(clusterLabelFrame);
      clearClusterLabels();
      map.remove();
      mapRef.current = null;
    };
  }, [style, syncArgoMarker]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const eventSource = map.getSource("events") as GeoJSONSource | undefined;
    if (!eventSource) return undefined;
    eventSource.setData(toGeoJSON(events));
    if (selectedId) map.setFeatureState({ source: "events", id: selectedId }, { selected: true });
  }, [events]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const eventSource = map.getSource("events") as GeoJSONSource | undefined;
    if (!eventSource) return;
    const previousId = selectedEventStateRef.current;
    if (previousId && previousId !== selectedId) {
      map.removeFeatureState({ source: "events", id: previousId }, "selected");
    }
    if (selectedId) map.setFeatureState({ source: "events", id: selectedId }, { selected: true });
    selectedEventStateRef.current = selectedId;
    (map.getSource("event-selection") as GeoJSONSource | undefined)?.setData(
      toSelectedEventGeoJSON(events, selectedId),
    );
  }, [events, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("sst-grid") as GeoJSONSource | undefined)?.setData(toSstGridGeoJSON(observations));
  }, [observations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const applyVisualDensity = () => {
      if (map.getLayer("world-land")) {
        map.setPaintProperty("world-land", "fill-color", lightOcean ? "#d8e1d8" : "#294741");
        map.setPaintProperty("world-land", "fill-opacity", lightOcean ? 0.96 : 0.92);
      }
      if (map.getLayer("world-country-boundaries")) {
        map.setPaintProperty("world-country-boundaries", "line-color", lightOcean ? "#68817c" : "#75958d");
        map.setPaintProperty("world-country-boundaries", "line-opacity", lightOcean ? 0.76 : 0.62);
      }
      if (map.getLayer("standard-map-foreign-land")) {
        map.setPaintProperty("standard-map-foreign-land", "fill-color", lightOcean ? "#b5c7ba" : "#203d39");
        map.setPaintProperty(
          "standard-map-foreign-land",
          "fill-opacity",
          ["interpolate", ["linear"], ["zoom"], 0.35, 1, 6.8, 1, 8.2, 0],
        );
      }
      if (map.getLayer("china-provinces")) {
        map.setPaintProperty("china-provinces", "fill-color", lightOcean ? "#cbdacb" : "#35534f");
        map.setPaintProperty(
          "china-provinces",
          "fill-opacity",
          ["interpolate", ["linear"], ["zoom"], 0.35, lightOcean ? 0.98 : 0.9, 6.8, lightOcean ? 0.98 : 0.9, 8.2, 0],
        );
      }
      if (map.getLayer("standard-map-taiwan-province")) {
        map.setPaintProperty("standard-map-taiwan-province", "fill-color", lightOcean ? "#cbdacb" : "#35534f");
        map.setPaintProperty("standard-map-taiwan-province", "fill-opacity", 1);
      }
      if (map.getLayer("street-reference")) {
        map.setPaintProperty("street-reference", "raster-saturation", lightOcean ? -0.12 : -0.32);
        map.setPaintProperty("street-reference", "raster-contrast", lightOcean ? 0.04 : 0.16);
        map.setPaintProperty("street-reference", "raster-brightness-min", lightOcean ? 0.34 : 0.08);
        map.setPaintProperty("street-reference", "raster-brightness-max", lightOcean ? 0.98 : 0.64);
        map.setPaintProperty(
          "street-reference",
          "raster-opacity",
          ["interpolate", ["linear"], ["zoom"], 7, 0, 8, lightOcean ? 0.42 : 0.32, 10, lightOcean ? 0.9 : 0.78, 12, lightOcean ? 1 : 0.92],
        );
      }
      if (!map.getLayer("argo-observation-points") || !map.getLayer("argo-fleet-points")) return;
      if (map.getLayer("argo-observation-clusters")) {
        map.setPaintProperty("argo-observation-clusters", "circle-color", lightOcean
          ? ["step", ["get", "point_count"], "#278b96", 80, "#207a89", 300, "#186878", 1_000, "#105565"]
          : ["step", ["get", "point_count"], "#3a9998", 80, "#2f8488", 300, "#286e79", 1_000, "#205a69"]);
        map.setPaintProperty("argo-observation-clusters", "circle-opacity", lightOcean ? 0.94 : 0.88);
        map.setPaintProperty("argo-observation-clusters", "circle-stroke-width", lightOcean ? 2.5 : 2);
        map.setPaintProperty("argo-observation-clusters", "circle-stroke-color", lightOcean ? "#f2ffff" : "#dff8f5");
      }
      if (map.getLayer("argo-fleet-bgc-symbols")) {
        map.setPaintProperty("argo-fleet-bgc-symbols", "icon-opacity", lightOcean ? 0.84 : 0.76);
      }
      map.setPaintProperty(
        "argo-observation-points",
        "circle-radius",
        lightOcean
          ? ["interpolate", ["linear"], ["zoom"], 4, 1.8, 6, 2.5, 8, 3.2]
          : ["interpolate", ["linear"], ["zoom"], 2, 1.7, 5, 2.8, 8, 4],
      );
      map.setPaintProperty(
        "argo-observation-points",
        "circle-opacity",
        lightOcean
          ? ["interpolate", ["linear"], ["zoom"], 4, 0.28, 6, 0.5, 8, 0.66]
          : 0.46,
      );
      map.setPaintProperty("argo-observation-points", "circle-stroke-width", lightOcean ? 0.7 : 0.4);
      map.setPaintProperty("argo-observation-points", "circle-stroke-color", lightOcean ? "#174b53" : "#102d2b");
      map.setPaintProperty(
        "argo-fleet-points",
        "circle-radius",
        lightOcean
          ? [
              "interpolate", ["linear"], ["zoom"],
              0.35, ["case", ["==", ["get", "candidate"], true], 5.8, ["==", ["get", "hasBGC"], true], 3.5, 1.05],
              2, ["case", ["==", ["get", "candidate"], true], 5.8, ["==", ["get", "hasBGC"], true], 3.5, 1.3],
              6, ["case", ["==", ["get", "candidate"], true], 5.8, ["==", ["get", "hasBGC"], true], 3.5, 2.5],
            ]
          : ["case", ["==", ["get", "candidate"], true], 5.8, ["==", ["get", "hasBGC"], true], 3.8, 2.8],
      );
      map.setPaintProperty(
        "argo-fleet-points",
        "circle-color",
        ["case", ["==", ["get", "candidate"], true], "#f06b58", ["==", ["get", "hasBGC"], true], "#c6d96b", lightOcean ? "#147f89" : "#47b7b5"],
      );
      map.setPaintProperty(
        "argo-fleet-points",
        "circle-opacity",
        lightOcean
          ? [
              "interpolate", ["linear"], ["zoom"],
              0.35, ["case", ["==", ["get", "candidate"], true], 0.98, ["==", ["get", "hasBGC"], true], 0.62, 0.06],
              2, ["case", ["==", ["get", "candidate"], true], 0.98, ["==", ["get", "hasBGC"], true], 0.62, 0.1],
              5, ["case", ["==", ["get", "candidate"], true], 0.98, ["==", ["get", "hasBGC"], true], 0.62, 0.3],
            ]
          : ["case", ["==", ["get", "candidate"], true], 0.98, ["==", ["get", "hasBGC"], true], 0.74, 0.42],
      );
      map.setPaintProperty(
        "argo-fleet-points",
        "circle-stroke-width",
        lightOcean
          ? ["case", ["==", ["get", "candidate"], true], 2, ["==", ["get", "hasBGC"], true], 0.9, 0.2]
          : ["case", ["==", ["get", "candidate"], true], 2, ["==", ["get", "hasBGC"], true], 1, 0.45],
      );
    };

    if (map.isStyleLoaded()) applyVisualDensity();
    else map.once("load", applyVisualDensity);
    return () => { map.off("load", applyVisualDensity); };
  }, [lightOcean]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("argo-observations") as GeoJSONSource | undefined)?.setData(
      toArgoObservationGeoJSON(argoRegion),
    );
  }, [argoRegion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("argo-fleet") as GeoJSONSource | undefined)?.setData(
      toArgoFleetGeoJSON(argoRegion, argoCoverage),
    );
  }, [argoRegion, argoCoverage]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (map.getSource("argo-track") as GeoJSONSource | undefined)?.setData(toArgoTrackGeoJSON(argo));
    (map.getSource("argo-latest") as GeoJSONSource | undefined)?.setData(toArgoLatestGeoJSON(argo));
    if (argo?.latest) {
      const coordinates: [number, number] = [argo.latest.longitude, argo.latest.latitude];
      if (!argoMarkerRef.current) {
        const marker = document.createElement("div");
        marker.className = "argo-float-marker";
        marker.setAttribute("role", "button");
        marker.setAttribute("tabindex", "0");
        marker.setAttribute("aria-label", `鎵撳紑 Argo ${argo.platform} 璇︾粏鏁版嵁`);
        marker.addEventListener("click", () => {
          const point = argoMarkerRef.current?.getLngLat();
          const platform = argoRef.current?.platform;
          if (point && platform) onProbeRef.current(point.lng, point.lat, platform, true);
        });
        marker.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          const point = argoMarkerRef.current?.getLngLat();
          const platform = argoRef.current?.platform;
          if (point && platform) onProbeRef.current(point.lng, point.lat, platform, true);
        });
        argoMarkerRef.current = new maplibregl.Marker({ element: marker, anchor: "center" })
          .setLngLat(coordinates)
          .addTo(map);
      }
      argoMarkerRef.current
        .setLngLat(coordinates)
        .getElement()
        .setAttribute("title", `Argo ${argo.platform} / Cycle ${argo.latest.cycle}`);
      argoMarkerRef.current
        .getElement()
        .setAttribute("aria-label", `鎵撳紑 Argo ${argo.platform} 璇︾粏鏁版嵁`);
    } else {
      argoMarkerRef.current?.remove();
      argoMarkerRef.current = null;
    }
    return undefined;
  }, [argo, syncArgoMarker]);

  useEffect(() => {
    probePointRef.current = probePoint;
    if (probePoint && mapCoordinateReadoutRef.current) {
      mapCoordinateReadoutRef.current.textContent = preciseCoordinateLabel(probePoint[0], probePoint[1]);
    } else if (mapCoordinateReadoutRef.current && mapRef.current) {
      const center = mapRef.current.getCenter();
      mapCoordinateReadoutRef.current.textContent = preciseCoordinateLabel(center.lng, center.lat);
    }
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource("sea-probe") as GeoJSONSource | undefined)?.setData(toProbeGeoJSON(probePoint, probeSelection));
  }, [probePoint, probeSelection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvasContainer().setAttribute("aria-label", `${region.name}地图`);
    map.fitBounds(region.bounds, { padding: 38, duration: 900, maxZoom: region.zoom + 0.6 });
  }, [region]);

  useEffect(() => {
    const map = mapRef.current;
    const selected = events.find((event) => event.id === selectedId);
    if (!map || !selected) return;
    if (!initialSelectionRef.current) {
      initialSelectionRef.current = true;
      return;
    }
    map.flyTo({ center: selected.centroid, zoom: Math.max(map.getZoom(), 3.6), duration: 900 });
  }, [events, selectedId]);

  const selectedProbeCandidate = probeSelection?.candidates.find(
    (candidate) => candidate.platform === probeSelection.selected_platform,
  );
  const selectedProbeIsNearest = probeSelection
    ? probeSelection.selected_platform === probeSelection.nearest_platform
    : false;
  const probeHeading = probeSurface === "land"
    ? "陆地点位"
    : probeSurface === "classifying"
      ? "正在判定海洋或陆地"
      : probeSurface === "unresolved"
        ? "海陆状态未确认"
        : probeContext
          ? marineSeaTitle(probeContext)
          : "海面点位观测";
  const probeEyebrow = probeSurface === "land"
    ? "LAND PROBE · 地表点位"
    : probeSurface === "classifying"
      ? "SURFACE CHECK · 地形判定"
      : probeSurface === "unresolved"
        ? "SURFACE CHECK · 未确认"
        : `SEA PROBE · ${visibleProbeSstReading ? `${visibleProbeSstReading.point.temperature.toFixed(1)} °C` : "实时点位"}`;

  return (
    <div ref={mapShellRef} className="map-shell">
      <div ref={containerRef} className="ocean-map" aria-label={`${region.name}海洋事件地图`} />
      <CurrentFieldLayer mapRef={mapRef} paused={loading} />
      <div className="map-readout" aria-hidden="true">
        <span>{region.name}</span>
        <strong ref={mapCoordinateReadoutRef}>{preciseCoordinateLabel(INITIAL_VIEW.center[0], INITIAL_VIEW.center[1])}</strong>
        <span ref={mapResolutionReadoutRef}>Z{INITIAL_VIEW.zoom.toFixed(1)} · 海洋</span>
      </div>
      <div className="map-tools">
        <button type="button" onClick={() => mapRef.current?.fitBounds(region.bounds, { padding: 38, duration: 650 })} title="恢复当前海域视图" aria-label="恢复当前海域视图">
          <LocateFixed size={16} />
        </button>
        {argo && (
          <>
          <button
            type="button"
            onClick={() => mapRef.current?.flyTo({ center: [argo.latest.longitude, argo.latest.latitude], zoom: 4.2, duration: 950 })}
            title={`定位 Argo ${argo.platform}`}
            aria-label={`定位 Argo ${argo.platform}`}
          >
            <Radio size={16} />
          </button>
          <button
            type="button"
            onClick={() => onProbeRef.current(argo.latest.longitude, argo.latest.latitude, argo.platform, true)}
            title={`\u6253\u5f00 Argo ${argo.platform} \u8be6\u7ec6\u6570\u636e`}
            aria-label={`\u6253\u5f00 Argo ${argo.platform} \u8be6\u7ec6\u6570\u636e`}
          >
            <PanelRightOpen size={16} />
          </button>
          </>
        )}
      </div>
      {probePoint && (
        <section
          ref={probePanelRef}
          className={`${probeLoading ? "sea-probe-panel updating" : "sea-probe-panel"}${probePanelCollapsed ? " collapsed" : ""}${probePanelDocked ? " docked-right" : ""} surface-${probeSurface}`}
          style={probePanelPosition ? { left: probePanelPosition.x, top: probePanelPosition.y } : undefined}
          aria-label={probeSurface === "land"
            ? "陆地点位与地表高程"
            : probeSurface === "ocean"
              ? "海面坐标与最近 Argo 浮标"
              : "坐标点海陆判定"}
          aria-busy={probeLoading}
        >
          {probeLoading && <span className="sea-probe-progress" />}
          <header
            className="sea-probe-heading"
            onPointerDown={startProbeDrag}
            onPointerMove={moveProbePanel}
            onPointerUp={stopProbeDrag}
            onPointerCancel={stopProbeDrag}
            title={probePanelDocked ? "向左拖动可退出右侧固定" : "拖到地图右缘可展开并固定"}
          >
            <span className="sea-probe-title-icon"><Crosshair size={18} /></span>
            <div className="sea-probe-title-copy">
              <span>{probeEyebrow}</span>
              <strong>{probeHeading}</strong>
            </div>
            <GripHorizontal className="sea-probe-drag-handle" size={16} aria-hidden="true" />
            <div className="sea-probe-actions">
              <button
                type="button"
                onClick={() => setProbePanelCollapsed((current) => !current)}
                title={probePanelCollapsed ? "展开点位观测" : "收起点位观测"}
                aria-label={probePanelCollapsed ? "展开点位观测" : "收起点位观测"}
                aria-expanded={!probePanelCollapsed}
              >
                {probePanelCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
              </button>
              <button type="button" onClick={copyProbeCoordinates} title="复制精确坐标" aria-label="复制精确坐标"><Copy size={14} /></button>
              <button type="button" onClick={frameProbe} title="定位当前坐标与匹配结果" aria-label="定位当前坐标与匹配结果"><LocateFixed size={14} /></button>
              <button
                type="button"
                onClick={() => requestProbe(probePoint[0], probePoint[1], probeSelection?.selected_platform, true)}
                disabled={probeLoading}
                title="重新查询当前坐标"
                aria-label="重新查询当前坐标"
              >
                <RefreshCw size={14} className={probeLoading ? "spinning" : ""} />
              </button>
              <button type="button" onClick={closeProbe} title="关闭坐标探针" aria-label="关闭坐标探针"><X size={15} /></button>
            </div>
          </header>
          <div className="sea-probe-coordinates">
            <div><span>经度</span><strong>{probeLongitudeLabel(probePoint[0])}</strong></div>
            <div><span>纬度</span><strong>{probeLatitudeLabel(probePoint[1])}</strong></div>
          </div>
          <SurfaceClassificationCard state={probeSurface} />
          {copernicusLoading && (
            <section className="copernicus-wave-loading" role="status" aria-live="polite" aria-busy="true">
              <RefreshCw size={17} aria-hidden="true" />
              <div>
                <strong>正在获取 Copernicus Marine 数据</strong>
                <span>正在读取最近海况与风场，首次请求可能需要几秒钟…</span>
              </div>
            </section>
          )}
          {visibleProbeSstReading ? (
            <section className="sea-probe-sst" data-testid="selected-sst-reading" aria-label="所选点海表温度">
              <div className="sea-probe-sst-reading">
                <Thermometer size={17} aria-hidden="true" />
                <div>
                  <span>所选点海表温度</span>
                  <strong>{visibleProbeSstReading.point.temperature.toFixed(2)} <small>°C</small></strong>
                </div>
                <b>NOAA</b>
              </div>
              <div className="sea-probe-sst-meta">
                <span>{formatDateTime(visibleProbeSstReading.point.timestamp)} 观测</span>
                {visibleProbeSstReading.point.analysis_error != null && (
                  <span>分析误差 ±{visibleProbeSstReading.point.analysis_error.toFixed(2)} °C</span>
                )}
                <span>最近有效格点 {visibleProbeSstReading.distanceKm < 0.1 ? "<0.1" : visibleProbeSstReading.distanceKm.toFixed(1)} km</span>
              </div>
              <small className="sea-probe-sst-grid">
                NOAA 逐日融合海温 · 格点 {latitudeLabel(visibleProbeSstReading.point.latitude)} / {longitudeLabel(visibleProbeSstReading.point.longitude)}
              </small>
            </section>
          ) : probeSurface === "ocean" && observations && (
            <div className="sea-probe-sst-unavailable" data-testid="selected-sst-unavailable">
              <Thermometer size={14} aria-hidden="true" />
              <span>该坐标附近暂无通过质量控制的海温格点</span>
            </div>
          )}
          <BathymetryCard
            profile={probeBathymetry}
            loading={probeBathymetryLoading}
            error={probeBathymetryError}
          />
          {(latestCopernicusWave || latestCopernicusWind) && (
            <section className="copernicus-wave-card" aria-label="Copernicus Marine 海况数据">
              <header>
                <div><span>COPERNICUS MARINE</span><strong>模式海况</strong></div>
                <small>海况 / 风场独立时次</small>
              </header>
              <div className="copernicus-wave-metrics">
                <div><span>有效波高</span><strong>{latestCopernicusWave?.VHM0?.toFixed(2) ?? "--"}</strong><small>m</small></div>
                <div><span>平均周期</span><strong>{latestCopernicusWave?.VTM02?.toFixed(1) ?? "--"}</strong><small>s</small></div>
                <div><span>平均波向</span><strong>{latestCopernicusWave?.VMDR?.toFixed(0) ?? "--"}</strong><small>°</small></div>
              </div>
              <div className="copernicus-wind-metrics">
                <div><span>海面风速</span><strong>{latestCopernicusWind?.wind_speed?.toFixed(1) ?? "--"}</strong><small>m/s</small></div>
                <div><span>风向（来向）</span><strong>{latestCopernicusWind?.wind_direction_from?.toFixed(0) ?? "--"}</strong><small>°</small></div>
              </div>
              <div className="copernicus-wave-secondary">
                <span>一级涌浪 <b>{latestCopernicusWave?.VHM0_SW1?.toFixed(2) ?? "--"} m</b></span>
                <span>涌浪方向 <b>{latestCopernicusWave?.VMDR_SW1?.toFixed(0) ?? "--"}°</b></span>
                <span>风浪 <b>{latestCopernicusWave?.VHM0_WW?.toFixed(2) ?? "--"} m</b></span>
                <span>风浪方向 <b>{latestCopernicusWave?.VMDR_WW?.toFixed(0) ?? "--"}°</b></span>
              </div>
              <div className="copernicus-source-timing">
                {copernicusWave && (
                  <section>
                    <header><strong>海况延迟</strong><b>{formatDataLatency(copernicusWave.data_latency_seconds)}</b></header>
                    <span>数据时次 {copernicusWave.latest_valid_time ? formatDateTime(copernicusWave.latest_valid_time) : "--"}</span>
                    <span>网格 {copernicusWave.grid_longitude.toFixed(6)}°E, {copernicusWave.grid_latitude.toFixed(6)}°N</span>
                    <span>距目标 {copernicusWave.grid_distance_km.toFixed(3)} km · 最近邻节点</span>
                    <span>空间插值：无 · 时间插值：无（原生 {copernicusWave.temporal_resolution_hours} 小时）</span>
                  </section>
                )}
                {copernicusWind && (
                  <section>
                    <header><strong>风场延迟</strong><b>{formatDataLatency(copernicusWind.data_latency_seconds)}</b></header>
                    <span>数据时次 {copernicusWind.latest_valid_time ? formatDateTime(copernicusWind.latest_valid_time) : "--"}</span>
                    <span>网格 {copernicusWind.grid_longitude.toFixed(6)}°E, {copernicusWind.grid_latitude.toFixed(6)}°N</span>
                    <span>距目标 {copernicusWind.grid_distance_km.toFixed(3)} km · 最近邻节点</span>
                    <span>物理推导：u/v 风矢量合成 · 空间/时间插值：无</span>
                  </section>
                )}
              </div>
              <button type="button" className="copernicus-history-trigger" onClick={toggleCopernicusHistory}>
                <span>{copernicusHistoryOpen ? "收起完整历史" : "查看完整历史"}</span>
                <small>{copernicusWaveHistory && copernicusWindHistory ? `${copernicusWaveHistory.total + copernicusWindHistory.total} 条已入库` : "首次展开将全量同步"}</small>
              </button>
              {copernicusHistoryOpen && (
                <div className="copernicus-history-panel">
                  {copernicusHistoryLoading && <span className="copernicus-history-status">正在同步该网格全部可用历史数据…</span>}
                  {copernicusHistoryError && <span className="copernicus-history-status error">{copernicusHistoryError}</span>}
                  {copernicusWaveHistory && (
                    <section>
                      <header><strong>波浪历史</strong><b>{copernicusWaveHistory.total} 条</b></header>
                      <small>{copernicusWaveHistory.start_datetime?.slice(0, 10) ?? "--"} 至 {copernicusWaveHistory.end_datetime?.slice(0, 10) ?? "--"}</small>
                      {copernicusWaveHistory.records.slice(0, 8).map((record) => (
                        <div key={`wave-${record.timestamp}`}><span>{typeof record.timestamp === "string" ? formatDateTime(record.timestamp) : "--"}</span><b>{typeof record.VHM0 === "number" ? `${record.VHM0.toFixed(2)} m` : "--"}</b></div>
                      ))}
                    </section>
                  )}
                  {copernicusWindHistory && (
                    <section>
                      <header><strong>风场历史</strong><b>{copernicusWindHistory.total} 条</b></header>
                      <small>{copernicusWindHistory.start_datetime?.slice(0, 10) ?? "--"} 至 {copernicusWindHistory.end_datetime?.slice(0, 10) ?? "--"}</small>
                      {copernicusWindHistory.records.slice(0, 8).map((record) => (
                        <div key={`wind-${record.timestamp}`}><span>{typeof record.timestamp === "string" ? formatDateTime(record.timestamp) : "--"}</span><b>{typeof record.wind_speed === "number" ? `${record.wind_speed.toFixed(1)} m/s` : "--"}</b></div>
                      ))}
                    </section>
                  )}
                </div>
              )}
              <footer>
                <span>海况约 9 km / 3小时 · 风场约 14 km / 1小时</span>
                <span title="当前采用最近网格节点，数值没有做双线性空间插值">最近邻 · 无插值</span>
              </footer>
            </section>
          )}
          {probeNotice && <div className="sea-probe-notice" role="status">{probeNotice}</div>}
          {probeSurface === "ocean" && probeError && (
            <div className="sea-probe-error" role="alert">
              <span>{probeError}</span>
              <button type="button" onClick={() => requestProbe(probePoint[0], probePoint[1], probeSelection?.selected_platform)} title="重试坐标查询" aria-label="重试坐标查询"><RefreshCw size={13} /></button>
            </div>
          )}
          {probeSurface === "ocean" && probeLoading && !probeSelection && (
            <div className="sea-probe-loading"><Radio size={17} /><span>正在匹配最近活跃浮标...</span></div>
          )}
          {probeSurface === "ocean" && probeSelection && (
            <div className="sea-probe-result">
              <div className="sea-probe-nearest">
                <span className="sea-probe-live-dot" />
                <div>
                  <span>{selectedProbeIsNearest ? "自动最近" : "手动候选"} · {selectedProbeCandidate?.has_bgc ? "BGC-Argo" : "Core Argo"}</span>
                  <strong>浮标 {probeSelection.selected_platform}</strong>
                </div>
                <b>{probeSelection.selected_distance_km.toFixed(2)} km</b>
              </div>
              <div className="sea-probe-observation">
                <span>{formatDateTime(probeSelection.snapshot.latest.timestamp)} 剖面观测</span>
                <span>Cycle {probeSelection.snapshot.latest.cycle}</span>
                <span>{latitudeLabel(probeSelection.snapshot.latest.latitude)} · {longitudeLabel(probeSelection.snapshot.latest.longitude)}</span>
              </div>
              <div className="sea-probe-association">点击点与浮标相距 {probeSelection.selected_distance_km.toFixed(2)} km；以下 Argo 数值来自浮标位置，不代表点击点实测。</div>
              <div className="sea-probe-metrics">
                {PROBE_METRICS.map((metric) => {
                  const value = probeSelection.snapshot.latest.surface[metric.key];
                  return (
                    <div key={metric.key}>
                      <span>{metric.label}</span>
                      <strong>{typeof value === "number" ? value.toFixed(metric.digits) : "--"}</strong>
                      <small>{metric.unit}</small>
                    </div>
                  );
                })}
              </div>
              <ArgoProbeProfile snapshot={probeSelection.snapshot} />
              <div className="sea-probe-profile-meta">
                <span>最大压力 {probeSelection.snapshot.latest.max_pressure?.toFixed(0) ?? "--"} dbar</span>
                <span>{probeSelection.snapshot.latest.sample_count} 个深度采样点</span>
                <span>位置 QC {probeSelection.snapshot.latest.position_qc ?? "--"}</span>
              </div>
              <div className="sea-probe-candidates">
                <div><span>最近候选</span><small>{probeSelection.regional_float_count} 个区域活跃浮标</small></div>
                <div role="listbox" aria-label="切换最近 Argo 浮标">
                  {probeSelection.candidates.slice(0, 6).map((candidate) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={candidate.platform === probeSelection.selected_platform}
                      className={candidate.platform === probeSelection.selected_platform ? "selected" : ""}
                      onClick={() => requestProbe(probePoint[0], probePoint[1], candidate.platform)}
                      disabled={probeLoading}
                      key={candidate.platform}
                    >
                      <span>{candidate.platform}<i className={candidate.has_bgc ? "bgc" : ""} /></span>
                      <small>{candidate.distance_km?.toFixed(1)} km</small>
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="sea-probe-detail-trigger"
                onClick={() => setProbeDetailsOpen(true)}
              >
                <span><PanelRightOpen size={15} />完整浮标详情</span>
                <small>{probeSelection.snapshot.latest.sample_count} 个深度点 · {probeSelection.snapshot.track.length} 个轨迹点</small>
              </button>
              {probeContext && <MarineContextCard context={probeContext} />}
              {probeKnowledgeLoading && !probeKnowledge && (
                <div className="marine-knowledge-loading" role="status"><BookOpen size={14} /><span>正在加载内置海域百科条目...</span></div>
              )}
              {probeKnowledge && <MarineKnowledgeCard knowledge={probeKnowledge} context={probeContext ?? undefined} />}
              <footer>
                <span>{probeSelection.snapshot.source.credit}</span>
                <a href={probeSelection.snapshot.source.gdac_url} target="_blank" rel="noreferrer">GDAC <ExternalLink size={11} /></a>
              </footer>
            </div>
          )}
        </section>
        )}
      {probeSurface === "ocean" && !probeSelection && probeContext && (
        <>
          <MarineContextCard context={probeContext} />
          {probeKnowledgeLoading && !probeKnowledge && (
            <div className="marine-knowledge-loading" role="status"><BookOpen size={14} /><span>正在加载内置海域百科条目...</span></div>
          )}
            {probeKnowledge && <MarineKnowledgeCard knowledge={probeKnowledge} context={probeContext ?? undefined} />}
        </>
      )}
      {probeSurface === "ocean" && probeDetailsOpen && probePoint && probeSelection && (
        <div
          className="sea-probe-detail-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setProbeDetailsOpen(false);
          }}
        >
          <aside
            className="sea-probe-detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sea-probe-detail-title"
          >
            <header className="sea-probe-detail-header">
              <div>
                <span>ARGO FLOAT DETAIL</span>
                <h2 id="sea-probe-detail-title">浮标 {probeSelection.selected_platform} 详细观测</h2>
                <small>
                  距点击点 {probeSelection.selected_distance_km.toFixed(2)} km · {longitudeLabel(probePoint[0])} / {latitudeLabel(probePoint[1])}
                </small>
              </div>
              <button type="button" onClick={() => setProbeDetailsOpen(false)} title="关闭浮标详情" aria-label="关闭浮标详情">
                <X size={18} />
              </button>
            </header>
            <div className="sea-probe-detail-body">
              <ArgoLivePanel
                snapshot={probeSelection.snapshot}
                coverage={null}
                loading={false}
                error={probeError}
                onSelectPlatform={(platform) => requestProbe(probePoint[0], probePoint[1], platform)}
                marineContext={floatContext}
                marineKnowledge={floatKnowledge}
                marineEnrichmentLoading={floatEnrichmentLoading}
                expanded
                mode={mode}
              />
            </div>
          </aside>
        </div>
      )}
      <div className={layerCardCollapsed ? "map-layer-card collapsed" : "map-layer-card"}>
        <button type="button" className="map-layer-heading" onClick={() => setLayerCardCollapsed((current) => !current)} aria-expanded={!layerCardCollapsed} title={layerCardCollapsed ? "展开信息图层" : "收起信息图层"}>
          <span>信息图层</span><b>{events.length}</b>{loading ? <small className="map-layer-loading">加载中</small> : null}{layerCardCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
        {!layerCardCollapsed && (
          <div className="map-layer-content">
            <div className="map-layer-row argo-layer-row" title="圆环大小表示该海域的历史剖面密度，点击后展开"><i className="layer-dot argo-profile" /><span>历史剖面（点击展开）</span><b>{argoRegion?.profile_count ?? 0}</b></div>
            <div className="map-layer-row argo-layer-row" title="青色实心点表示当前仍在回传数据的 Argo 浮标"><i className="layer-dot argo" /><span>当前活动浮标</span><b>{argoRegion?.float_count ?? 0}</b></div>
            <div className="map-layer-row argo-layer-row" title="黄绿色菱形表示带生物地球化学传感器的浮标"><i className="layer-dot bgc" /><span>BGC 生地化浮标</span><b>{argoRegion?.bgc_float_count ?? 0}</b></div>
            <div className="map-layer-row" title="蓝色方点表示 NOAA 最新海表温度观测格点"><i className="layer-dot satellite" /><span>实时海温格点</span><b>{observations?.sst_latest_grid_count ?? 0}</b></div>
            <div className="map-layer-row" title="珊瑚红靶点只表示已进入筛查流程的温度或碳循环候选"><i className="layer-dot heat" /><span>温度 / 碳候选</span><b>{events.filter((event) => event.event_kind === "anomaly" && ["marine_heatwave", "surface_temperature_anomaly", "carbon_anomaly"].includes(event.type)).length}</b></div>
            <div className="map-layer-row" title="绿色标记只表示已进入筛查流程的生物过程候选"><i className="layer-dot bloom" /><span>生物过程候选</span><b>{events.filter((event) => event.event_kind === "anomaly" && ["phytoplankton_bloom", "chlorophyll_anomaly", "nutrient_anomaly"].includes(event.type)).length}</b></div>
            <div className="map-layer-row" title="紫色标记只表示已进入筛查流程的动力过程候选"><i className="layer-dot dynamics" /><span>动力过程候选</span><b>{events.filter((event) => event.event_kind === "anomaly" && ["eddy", "current_anomaly"].includes(event.type)).length}</b></div>
            {probePoint && <div className="map-layer-row" title="当前点击坐标探针"><i className="layer-dot probe" /><span>当前坐标探针</span><b>1</b></div>}
            {(latestCopernicusWave || latestCopernicusWind) && <div className="map-layer-row" title="当前坐标的 Copernicus Marine 海况模式点"><i className="layer-dot copernicus" /><span>Copernicus 海况点</span><b>1</b></div>}
          </div>
        )}
      </div>
      <a className="map-source-badge" href="/maps/china-standard-map-gs2023-2767.jpg" target="_blank" rel="noreferrer" title="查看自然资源部标准地图原图">
        <BadgeCheck size={14} />
        <span>{TIANDITU_TOKEN ? "天地图官方底图" : "自然资源部标准地图"}<b>{TIANDITU_TOKEN ? "中文矢量服务" : REVIEW_NUMBER}</b></span>
        <ExternalLink size={12} />
      </a>
    </div>
  );
});

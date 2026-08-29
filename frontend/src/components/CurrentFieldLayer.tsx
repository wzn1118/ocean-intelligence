import type { Map } from "maplibre-gl";
import { useEffect, useRef, useState, type RefObject } from "react";
import { oceanApi } from "../api";
import { formatDateTime } from "../locale";
import type { CopernicusCurrentField } from "../types";

interface CurrentFieldLayerProps {
  mapRef: RefObject<Map | null>;
  paused: boolean;
}

interface Particle {
  longitude: number;
  latitude: number;
  age: number;
  maxAge: number;
}

interface Vector {
  u: number;
  v: number;
  speed: number;
}

const PARTICLE_LIMIT = 2400;
const VISUAL_SECONDS_PER_SECOND = 14400;

function findInterval(values: number[], value: number): number {
  if (values.length < 2 || value < values[0] || value > values[values.length - 1]) return -1;
  let low = 0;
  let high = values.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (values[middle] <= value) low = middle;
    else high = middle;
  }
  return low;
}

function sampleVector(field: CopernicusCurrentField, longitude: number, latitude: number): Vector | null {
  const column = findInterval(field.longitudes, longitude);
  const row = findInterval(field.latitudes, latitude);
  if (column < 0 || row < 0) return null;
  const xRange = field.longitudes[column + 1] - field.longitudes[column];
  const yRange = field.latitudes[row + 1] - field.latitudes[row];
  if (!xRange || !yRange) return null;
  const x = (longitude - field.longitudes[column]) / xRange;
  const y = (latitude - field.latitudes[row]) / yRange;
  const indices = [
    row * field.width + column,
    row * field.width + column + 1,
    (row + 1) * field.width + column,
    (row + 1) * field.width + column + 1,
  ];
  const vectors = indices.map((index) => ({ u: field.u[index], v: field.v[index] }));
  if (vectors.some((vector) => vector.u == null || vector.v == null)) return null;
  const topU = vectors[0].u! * (1 - x) + vectors[1].u! * x;
  const bottomU = vectors[2].u! * (1 - x) + vectors[3].u! * x;
  const topV = vectors[0].v! * (1 - x) + vectors[1].v! * x;
  const bottomV = vectors[2].v! * (1 - x) + vectors[3].v! * x;
  const u = topU * (1 - y) + bottomU * y;
  const v = topV * (1 - y) + bottomV * y;
  return { u, v, speed: Math.hypot(u, v) };
}

function seedParticle(field: CopernicusCurrentField): Particle | null {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const longitude = field.bounds[0][0] + Math.random() * (field.bounds[1][0] - field.bounds[0][0]);
    const latitude = field.bounds[0][1] + Math.random() * (field.bounds[1][1] - field.bounds[0][1]);
    if (sampleVector(field, longitude, latitude)) {
      return { longitude, latitude, age: Math.random() * 110, maxAge: 140 + Math.random() * 120 };
    }
  }
  return null;
}

function particleColor(speed: number, maximumSpeed: number): string {
  const ratio = Math.max(0, Math.min(1, speed / Math.max(0.25, maximumSpeed * 0.72)));
  const hue = 190 - ratio * 145;
  const lightness = 78 - ratio * 10;
  return `hsla(${hue}, 100%, ${lightness}%, ${0.68 + ratio * 0.3})`;
}

function requestBounds(map: Map): [[number, number], [number, number]] {
  const bounds = map.getBounds();
  const south = Math.max(-80, bounds.getSouth());
  const north = Math.min(89.5, bounds.getNorth());
  const span = bounds.getEast() - bounds.getWest();
  if (span >= 350 || bounds.getWest() < -180 || bounds.getEast() > 180) {
    return [[-180, south], [180, north]];
  }
  return [[bounds.getWest(), south], [bounds.getEast(), north]];
}

export function CurrentFieldLayer({ mapRef, paused }: CurrentFieldLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<CopernicusCurrentField | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const requestInFlightRef = useRef(false);
  const [field, setField] = useState<CopernicusCurrentField | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [mapInstance, setMapInstance] = useState<Map | null>(null);

  useEffect(() => {
    if (mapRef.current) {
      setMapInstance(mapRef.current);
      return;
    }
    const timer = window.setInterval(() => {
      if (mapRef.current) {
        setMapInstance(mapRef.current);
        window.clearInterval(timer);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [mapRef]);

  useEffect(() => {
    const map = mapInstance;
    if (!map || paused) return;
    let timer = 0;
    let lastRequestKey = "";
    const load = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const canvas = canvasRef.current;
        if (!canvas || requestInFlightRef.current) return;
        const controller = new AbortController();
        abortRef.current = controller;
        requestInFlightRef.current = true;
        setState(fieldRef.current ? "ready" : "loading");
        const bounds = requestBounds(map);
        const width = Math.max(40, Math.min(72, Math.round(canvas.clientWidth / 20)));
        const height = Math.max(28, Math.min(48, Math.round(canvas.clientHeight / 20)));
        const requestKey = `${bounds.flat().map((value) => value.toFixed(2)).join(":")}:${width}:${height}`;
        if (requestKey === lastRequestKey) return;
        lastRequestKey = requestKey;
        oceanApi.copernicusCurrentField(bounds, { width, height }, controller.signal)
          .then((result) => {
            fieldRef.current = result;
            particlesRef.current = [];
            setField(result);
            setState("ready");
          })
          .catch((error: unknown) => {
            if ((error as Error).name !== "AbortError") setState(fieldRef.current ? "ready" : "error");
          })
          .finally(() => {
            requestInFlightRef.current = false;
          });
      }, 1800);
    };
    if (map.loaded()) load();
    else map.once("load", load);
    map.on("moveend", load);
    const refresh = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(refresh);
      abortRef.current?.abort();
      map.off("load", load);
      map.off("moveend", load);
    };
  }, [mapInstance, paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const map = mapInstance;
    if (!canvas || !host || !map) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frameId = 0;
    let previousTime = performance.now();
    const resize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(host.clientWidth * pixelRatio));
      const height = Math.max(1, Math.round(host.clientHeight * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${host.clientWidth}px`;
        canvas.style.height = `${host.clientHeight}px`;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const render = (now: number) => {
      const delta = Math.min(0.05, Math.max(0.001, (now - previousTime) / 1000));
      previousTime = now;
      const currentField = fieldRef.current;
      if (!paused && currentField) {
        const zoom = map.getZoom();
        const overviewTimeScale = Math.max(1, Math.min(10, 2 ** (6.5 - zoom)));
        context.globalCompositeOperation = "destination-out";
        context.fillStyle = "rgba(0,0,0,0.16)";
        context.fillRect(0, 0, host.clientWidth, host.clientHeight);
        context.globalCompositeOperation = "source-over";
        const desiredCount = Math.min(PARTICLE_LIMIT, Math.max(520, Math.round(host.clientWidth * host.clientHeight / 430)));
        while (particlesRef.current.length < desiredCount) {
          const particle = seedParticle(currentField);
          if (!particle) break;
          particlesRef.current.push(particle);
        }
        context.lineWidth = Math.min(2, 1.25 + Math.max(0, 5.5 - zoom) * 0.18);
        context.lineCap = "round";
        for (let index = particlesRef.current.length - 1; index >= 0; index -= 1) {
          const particle = particlesRef.current[index];
          const vector = sampleVector(currentField, particle.longitude, particle.latitude);
          if (!vector || particle.age >= particle.maxAge) {
            const replacement = seedParticle(currentField);
            if (replacement) particlesRef.current[index] = replacement;
            else particlesRef.current.splice(index, 1);
            continue;
          }
          const previous = map.project([particle.longitude, particle.latitude]);
          const simulationSeconds = delta * VISUAL_SECONDS_PER_SECOND * overviewTimeScale;
          const cosine = Math.max(0.12, Math.cos(particle.latitude * Math.PI / 180));
          particle.longitude += vector.u * simulationSeconds / (111_320 * cosine);
          particle.latitude += vector.v * simulationSeconds / 111_320;
          particle.age += 1;
          const next = map.project([particle.longitude, particle.latitude]);
          if (next.x < -20 || next.y < -20 || next.x > host.clientWidth + 20 || next.y > host.clientHeight + 20) {
            particle.age = particle.maxAge;
            continue;
          }
          context.beginPath();
          context.moveTo(previous.x, previous.y);
          context.lineTo(next.x, next.y);
          context.strokeStyle = particleColor(vector.speed, currentField.maximum_speed);
          context.stroke();
        }
      }
      frameId = requestAnimationFrame(render);
    };
    frameId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [mapInstance, paused]);

  return (
    <div ref={hostRef} className={`current-field-layer is-${state}`} aria-hidden="true">
      <canvas ref={canvasRef} className="current-field-canvas" />
      <div className="current-field-status">
        <strong>Copernicus Marine 准实时表层海流</strong>
        <span>{state === "loading" ? "正在读取最新有效矢量场" : state === "error" ? "准实时海流暂不可用" : `${field?.timestamp ? formatDateTime(field.timestamp) : "最新时次"} · 延迟 ${field?.latency_hours?.toFixed(1) ?? "--"} h · ${field?.depth?.toFixed(1) ?? "0.0"} m`}</span>
        {field && (
          <span className="current-field-scale">
            <small>0</small><i /><small>{field.maximum_speed.toFixed(2)} m/s</small>
          </span>
        )}
      </div>
    </div>
  );
}

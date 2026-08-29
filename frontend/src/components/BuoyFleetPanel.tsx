import { Download, Eye, EyeOff, List, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { oceanApi } from "../api";
import type { ArgoFloatHistory, ArgoProfile, ArgoRegionSnapshot, ArgoRegionalFloat } from "../types";

interface BuoyFleetPanelProps {
  snapshot: ArgoRegionSnapshot | null;
  loading?: boolean;
  selectedPlatform?: string | null;
  monitoredPlatforms: Set<string>;
  monitoredOnly?: boolean;
  onViewChange?: (monitoredOnly: boolean) => void;
  onToggleMonitor: (platform: string) => void;
  onSelect: (platform: string) => void;
  onClose: () => void;
}

function csvCell(value: string | number | boolean | null | undefined) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function exportRecentBuoyDates(history: ArgoFloatHistory) {
  const headers = ["platform", "profile_id", "cycle", "timestamp", "longitude", "latitude", "pressure_dbar", "temperature_c", "temperature_qc", "temperature_mode", "salinity_psu", "salinity_qc", "salinity_mode", "chla_mg_m3", "chla_qc", "chla_mode", "nitrate_umol_kg", "nitrate_qc", "nitrate_mode"];
  const rows = history.profiles.flatMap((profile: ArgoProfile) => profile.points.map((point) => [
    history.platform,
    `${history.platform}_${profile.cycle}`,
    profile.cycle,
    profile.timestamp,
    profile.longitude,
    profile.latitude,
    point.pressure,
    point.temperature,
    point.temperature_qc,
    point.temperature_mode,
    point.salinity,
    point.salinity_qc,
    point.salinity_mode,
    point.chla,
    point.chla_qc,
    point.chla_mode,
    point.nitrate,
    point.nitrate_qc,
    point.nitrate_mode,
  ]));
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `argo-buoy-${history.platform}-latest-${history.date_count}-observation-dates-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatTime(timestamp: string) {
  if (!timestamp) return "时间未知";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function BuoyFleetPanel({ snapshot, loading = false, selectedPlatform, monitoredPlatforms, monitoredOnly = false, onViewChange, onToggleMonitor, onSelect, onClose }: BuoyFleetPanelProps) {
  const [query, setQuery] = useState("");
  const [bgcOnly, setBgcOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSummary, setExportSummary] = useState<string | null>(null);
  const buoys = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (snapshot?.floats ?? []).filter((buoy) => {
      if (monitoredOnly && !monitoredPlatforms.has(buoy.platform)) return false;
      if (bgcOnly && !buoy.has_bgc) return false;
      return !normalized || buoy.platform.toLowerCase().includes(normalized) || buoy.networks.join(" ").toLowerCase().includes(normalized);
    });
  }, [bgcOnly, monitoredOnly, monitoredPlatforms, query, snapshot]);
  const handleExport = async () => {
    if (!selectedPlatform) return;
    setExporting(true);
    setExportError(null);
    setExportSummary(null);
    try {
      const history = await oceanApi.argoFloatHistory(selectedPlatform, 7);
      exportRecentBuoyDates(history);
      const dateRange = history.observation_dates.length > 1
        ? `${history.observation_dates[0]} 至 ${history.observation_dates.at(-1)}`
        : history.observation_dates[0] ?? "日期未知";
      setExportSummary(`已导出 ${history.date_count} 个观测日期、${history.profiles.length} 个完整剖面 · ${dateRange}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "完整浮标数据导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="buoy-fleet-panel" aria-label={monitoredOnly ? "我的监控" : "所有浮标"}>
      <header className="buoy-fleet-header">
        <div>
          <span className="buoy-fleet-kicker"><List size={13} /> FLOAT FLEET · 浮标总览</span>
          <h2>{monitoredOnly ? "我的监控" : "所有活跃浮标"}</h2>
          <p>{monitoredOnly ? `${monitoredPlatforms.size} 个已监控浮标` : snapshot ? `${snapshot.float_count.toLocaleString("zh-CN")} 个全球活跃浮标 · 最近 ${snapshot.lookback_days} 天有回传` : loading ? "正在同步全球浮标目录" : "暂无浮标数据"}</p>
        </div>
        <button type="button" className="buoy-fleet-close" onClick={onClose} aria-label="关闭浮标总览" title="关闭浮标总览"><X size={16} /></button>
      </header>
      <div className="buoy-fleet-toolbar">
        <div className="buoy-view-tabs" role="tablist" aria-label="浮标视图">
          <button type="button" className={!monitoredOnly ? "active" : ""} onClick={() => onViewChange?.(false)} role="tab" aria-selected={!monitoredOnly}>全部</button>
          <button type="button" className={monitoredOnly ? "active" : ""} onClick={() => onViewChange?.(true)} role="tab" aria-selected={monitoredOnly}>我的监控 <b>{monitoredPlatforms.size}</b></button>
        </div>
        <label className="buoy-fleet-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索编号或网络" aria-label="搜索浮标" /></label>
        <button type="button" className={bgcOnly ? "buoy-filter active" : "buoy-filter"} onClick={() => setBgcOnly((value) => !value)} aria-pressed={bgcOnly}>BGC</button>
        <button type="button" className="buoy-export" onClick={() => void handleExport()} disabled={!selectedPlatform || exporting} title={selectedPlatform ? `导出浮标 ${selectedPlatform} 最近 7 个有观测数据的日期` : "请先选择浮标"}><Download size={14} /> {exporting ? "获取中" : "导出最近 7 个观测日"}</button>
      </div>
      <div className="buoy-fleet-list" role="list" aria-label="浮标列表">
        {loading && !snapshot && <div className="buoy-fleet-empty">正在加载浮标列表…</div>}
        {!loading && !buoys.length && <div className="buoy-fleet-empty">没有匹配的浮标</div>}
        {buoys.map((buoy: ArgoRegionalFloat) => (
          <div role="listitem" key={buoy.platform} className={selectedPlatform === buoy.platform ? "buoy-row selected" : "buoy-row"}>
            <span className={buoy.has_bgc ? "buoy-status bgc" : "buoy-status"} aria-hidden="true" />
            <button type="button" className="buoy-row-main buoy-select" onClick={() => onSelect(buoy.platform)} aria-label={`选择浮标 ${buoy.platform}`}><strong>{buoy.platform}</strong><small>{buoy.networks.join(" · ") || "Argo"}</small></button>
            <span className="buoy-row-meta"><b>{Math.abs(buoy.latitude).toFixed(2)}° {buoy.latitude >= 0 ? "N" : "S"}</b><small>{formatTime(buoy.timestamp)}</small></span>
            <button type="button" className={monitoredPlatforms.has(buoy.platform) ? "buoy-monitor active" : "buoy-monitor"} onClick={() => onToggleMonitor(buoy.platform)} aria-pressed={monitoredPlatforms.has(buoy.platform)} aria-label={monitoredPlatforms.has(buoy.platform) ? `取消监控浮标 ${buoy.platform}` : `监控浮标 ${buoy.platform}`} title={monitoredPlatforms.has(buoy.platform) ? "取消监控" : "加入监控"}>{monitoredPlatforms.has(buoy.platform) ? <Eye size={14} /> : <EyeOff size={14} />}</button>
          </div>
        ))}
      </div>
      <footer className="buoy-fleet-footer">{exportError ? exportError : exportSummary ? exportSummary : selectedPlatform ? `已选 ${selectedPlatform} · 将导出最近 7 个有观测数据的日期及全部深度值` : "先选择浮标，再导出该浮标最近 7 个观测日期的完整剖面"}</footer>
    </section>
  );
}

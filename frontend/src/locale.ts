import type { EventKind, EventLifecycleState, EventStatus, EventType, EventValidationState } from "./types";

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  surface_observation: "海面温度",
  hydrographic_observation: "温度与盐度",
  biogeochemical_observation: "叶绿素与营养盐",
  marine_heatwave: "海洋热浪",
  cold_anomaly: "冷异常",
  eddy: "中尺度涡",
  current_anomaly: "海流异常",
  phytoplankton_bloom: "浮游植物暴发",
  carbon_anomaly: "碳循环异常",
  salinity_anomaly: "盐度异常",
  nutrient_anomaly: "营养盐异常",
  chlorophyll_anomaly: "叶绿素异常",
  surface_temperature_anomaly: "海温异常",
  wave_anomaly: "高海况异常",
  wind_anomaly: "大风异常",
  typhoon_warning: "台风风险",
};

const OBSERVATION_TYPE_LABELS: Record<EventType, string> = {
  surface_observation: "海表观测",
  hydrographic_observation: "温盐观测",
  biogeochemical_observation: "生地化观测",
  marine_heatwave: "海表温度观测",
  cold_anomaly: "温度观测",
  eddy: "流场观测",
  current_anomaly: "表层流场观测",
  phytoplankton_bloom: "叶绿素 a 观测",
  carbon_anomaly: "海表 pCO2 观测",
  salinity_anomaly: "盐度观测",
  nutrient_anomaly: "营养盐观测",
  chlorophyll_anomaly: "叶绿素 a 观测",
  surface_temperature_anomaly: "海表温度观测",
  wave_anomaly: "波浪模式记录",
  wind_anomaly: "风场记录",
  typhoon_warning: "台风风险记录",
};

export function eventTypeLabel(type: EventType, eventKind: EventKind, variables: string[] = []) {
  if (eventKind === "anomaly") return EVENT_TYPE_LABELS[type] ?? type;

  const variableSet = new Set(variables);
  if (variableSet.has("PCO2") || variableSet.has("DIC")) return "海表 pCO2 观测";
  if (variableSet.has("CURRENT")) return "表层流场观测";
  if (variableSet.has("CHLA")) return "叶绿素 a 观测";
  if (variableSet.has("NITRATE")) return "营养盐观测";
  if (variableSet.has("SALINITY") && variableSet.has("TEMPERATURE")) return "温盐剖面观测";
  if (variableSet.has("SALINITY")) return "盐度观测";
  if (variableSet.has("SST")) return "海表温度观测";
  if (variableSet.has("TEMPERATURE")) return "温度观测";
  return OBSERVATION_TYPE_LABELS[type] ?? "海洋观测";
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  active: "活动中",
  watch: "持续关注",
  recovering: "恢复中",
};

export const EVENT_VALIDATION_LABELS: Record<EventValidationState, string> = {
  observed: "质检通过",
  screening: "实时筛查",
  corroborated: "交叉复核",
  confirmed: "已确认",
  scenario: "情景样本",
};

export const EVENT_LIFECYCLE_LABELS: Record<EventLifecycleState, string> = {
  detected: "首次检出",
  monitoring: "持续跟踪",
  corroborated: "交叉复核",
  confirmed: "已确认",
  weakening: "减弱观察",
  closed: "已关闭",
};

export const SEVERITY_LABELS: Record<string, string> = {
  critical: "严重",
  high: "较高",
  moderate: "中等",
};

export const SOURCE_LABELS: Record<string, string> = {
  "Satellite SST": "卫星海表温度",
  "Altimetry SLA": "卫星测高海面高度异常",
  "Ocean Color": "海洋水色",
  "BGC-Argo": "生物地球化学 Argo",
  "Surface Currents": "表层海流",
  "BGC-Argo 5906518": "BGC-Argo 浮标 5906518",
  "Carbonate model": "碳酸盐系统模型",
  "ERA5 winds": "ERA5 风场",
  "Ocean reanalysis": "海洋再分析",
  "Altimetry SSH": "卫星测高海面高度",
  NOAA_SST: "NOAA 逐日融合海温",
  NOAA_CHLA_ANOMALY: "NOAA VIIRS 叶绿素 a 日异常",
  ARGO_CORE: "Argo 实测剖面",
  BGC_ARGO: "BGC-Argo 实测剖面",
};

export const VARIABLE_LABELS: Record<string, string> = {
  SST: "海表温度",
  SLA: "海面高度异常",
  CHLA: "叶绿素 a",
  PCO2: "海表二氧化碳分压",
  DIC: "溶解无机碳",
  NITRATE: "硝酸盐",
  CURRENT: "海流",
  SSH: "海面高度",
  SSH_GRADIENT: "海面高度梯度",
  WIND: "风速",
  MIXED_LAYER: "混合层深度",
  SALINITY: "盐度",
  TEMPERATURE: "温度",
  WAVE_HEIGHT: "有效波高",
  WAVE_PERIOD: "平均波周期",
  WAVE_DIRECTION: "平均波向",
  SWELL_HEIGHT: "一级涌浪波高",
  WIND_WAVE_HEIGHT: "风浪波高",
  WIND_SPEED: "风速",
  WIND_DIRECTION: "风向",
  TYPHOON: "台风风险",
};

export const UNIT_LABELS: Record<string, string> = {
  degC: "°C",
  PSU: "PSU",
  "mg m-3": "mg m⁻³",
  "umol kg-1": "μmol kg⁻¹",
  uatm: "μatm",
  "m s-1": "m s⁻¹",
  "m per 100 km": "m/100 km",
  m: "m",
  degree: "°",
  s: "s",
};

export function sourceLabel(value: string) {
  return SOURCE_LABELS[value] ?? value;
}

export function variableLabel(value: string) {
  return VARIABLE_LABELS[value] ?? value;
}

export function unitLabel(value: string) {
  return UNIT_LABELS[value] ?? value;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}

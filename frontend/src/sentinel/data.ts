// ============================================================================
// HydroMind Sentinel — shared domain data + helpers
// Geographic context (areas, relief centers, safe zones, infrastructure) that
// the citizen/admin portals overlay on top of live sensor data from the API.
// ============================================================================

import type { RiskClass } from "../types";

export interface MonitoredArea {
  id: string;            // matches a backend node_id where a sensor exists
  name: string;          // citizen-facing neighbourhood / locality
  ward: string;
  city: string;
  state: "AP" | "TG" | "TN";
  lat: number;
  lng: number;
  population: number;
  lowLying: boolean;
}

// Real monitored nodes (krishna/godavari/hussain_sagar match the backend) plus
// surrounding localities that share a node for demo coverage.
export const AREAS: MonitoredArea[] = [
  { id: "krishna_river_01",  name: "KPHB Phase 4 Street 6",   ward: "Ward 32", city: "Vijayawada",  state: "AP", lat: 16.5062, lng: 80.6480, population: 142000, lowLying: true  },
  { id: "godavari_river_01", name: "Godavari Bund Road",   ward: "Ward 11", city: "Rajahmundry", state: "AP", lat: 17.0005, lng: 81.8040, population:  89000, lowLying: true  },
  { id: "hussain_sagar_01",  name: "Hussain Sagar Basin",  ward: "Ward 94", city: "Hyderabad",   state: "TG", lat: 17.4239, lng: 78.4738, population: 310000, lowLying: false },
  { id: "himayat_sagar_01",  name: "Himayat Sagar Catchment", ward: "Ward 3",  city: "Hyderabad",   state: "TG", lat: 17.3141, lng: 78.3926, population:  48000, lowLying: true  },
];

export interface ReliefCenter {
  id: string; name: string; type: "Relief Camp" | "Community Hall" | "School Shelter" | "Stadium";
  lat: number; lng: number; capacity: number; near: string;
}

export const RELIEF_CENTERS: ReliefCenter[] = [
  { id: "rc1", name: "Siddhartha Public School Shelter", type: "School Shelter",  lat: 16.5136, lng: 80.6289, capacity: 1200, near: "KPHB Phase 4 Street 6" },
  { id: "rc2", name: "Bhavanipuram Municipal Hall",      type: "Community Hall",  lat: 16.4842, lng: 80.6481, capacity:  600, near: "KPHB Phase 4 Street 6" },
  { id: "rc3", name: "Rajahmundry Indoor Stadium",       type: "Stadium",         lat: 17.0122, lng: 81.8028, capacity: 2500, near: "Godavari Bund Road" },
  { id: "rc4", name: "Lal Bahadur Shastri Stadium",     type: "Relief Camp",     lat: 17.3855, lng: 78.4726, capacity: 3000, near: "Hussain Sagar Basin" },
  { id: "rc5", name: "Secunderabad Community Hall",      type: "School Shelter",  lat: 17.4419, lng: 78.5001, capacity:  900, near: "Hussain Sagar Basin" },
  { id: "rc6", name: "Chilkur Mandal Relief Camp",       type: "Community Hall",  lat: 17.3050, lng: 78.3800, capacity:  700, near: "Himayat Sagar Catchment" },
];

export interface SafeZone {
  id: string; name: string; lat: number; lng: number; elevationNote: string;
}

export const SAFE_ZONES: SafeZone[] = [
  { id: "sz1", name: "Indrakeeladri Hill (Kanakadurga)", lat: 16.5129, lng: 80.6105, elevationNote: "Temple hill, +38 m above river — never flooded" },
  { id: "sz2", name: "Gunadala Hills",                   lat: 16.5245, lng: 80.6524, elevationNote: "Elevated residential ridge, +24 m above river datum" },
  { id: "sz3", name: "Rajahmundry Town High Ground",     lat: 17.0028, lng: 81.7768, elevationNote: "Inland plateau above Godavari flood plain" },
  { id: "sz4", name: "Banjara Hills (Road No. 12)",      lat: 17.4082, lng: 78.4357, elevationNote: "Elevated neighbourhood, west of Hussain Sagar — no flood history" },
  { id: "sz5", name: "Jubilee Hills",                    lat: 17.4322, lng: 78.4068, elevationNote: "High-ground area, 3 km west of lake — no flood record" },
  { id: "sz6", name: "Narsingi High Ground",             lat: 17.3620, lng: 78.3540, elevationNote: "Elevated plateau south-west of Himayat Sagar, above reservoir flood line" },
];

export type InfraKind = "hospital" | "school" | "road" | "transit";
export interface InfraAsset {
  id: string; name: string; kind: InfraKind; lat: number; lng: number;
  criticality: number; // 0-100
  area: string;        // area id
}

export const INFRA: InfraAsset[] = [
  { id: "h1", name: "Govt. General Hospital",      kind: "hospital", lat: 16.5070, lng: 80.6400, criticality: 95, area: "krishna_river_01" },
  { id: "h2", name: "Apollo Emergency Wing",       kind: "hospital", lat: 17.4200, lng: 78.4700, criticality: 90, area: "hussain_sagar_01" },
  { id: "s1", name: "Municipal High School #4",    kind: "school",   lat: 16.5030, lng: 80.6520, criticality: 70, area: "krishna_river_01" },
  { id: "s2", name: "Govt. Girls School",          kind: "school",   lat: 17.0040, lng: 81.8000, criticality: 65, area: "godavari_river_01" },
  { id: "r1", name: "Bandar Road Corridor",        kind: "road",     lat: 16.5050, lng: 80.6450, criticality: 85, area: "krishna_river_01" },
  { id: "r2", name: "Tank Bund Arterial",          kind: "road",     lat: 17.4250, lng: 78.4720, criticality: 88, area: "hussain_sagar_01" },
  { id: "t1", name: "Vijayawada Bus Terminal",     kind: "transit",  lat: 16.5180, lng: 80.6300, criticality: 80, area: "krishna_river_01" },
  { id: "t2", name: "MMTS Necklace Rd Station",     kind: "transit",  lat: 17.4280, lng: 78.4660, criticality: 75, area: "hussain_sagar_01" },
];

// ── Risk classification ──────────────────────────────────────────────────────
// Distance (cm) from sensor to water surface. LOWER distance = HIGHER water.
export function riskFromDistance(distanceCm: number | null): RiskClass {
  if (distanceCm == null) return "SAFE";
  if (distanceCm <= 40) return "CRITICAL";
  if (distanceCm <= 60) return "WARNING";
  if (distanceCm <= 80) return "WATCH";
  return "SAFE";
}

export interface RiskMeta { label: string; cls: "safe" | "watch" | "warn" | "crit"; color: string; bg: string; }
export const RISK_META: Record<RiskClass, RiskMeta> = {
  SAFE:     { label: "Safe",     cls: "safe",  color: "#1f9d55", bg: "#e7f6ed" },
  WATCH:    { label: "Watch",    cls: "watch", color: "#c98a00", bg: "#fdf3dc" },
  WARNING:  { label: "Warning",  cls: "warn",  color: "#e2680c", bg: "#fdeadb" },
  CRITICAL: { label: "Critical", cls: "crit",  color: "#d1242f", bg: "#fbe6e7" },
};

export function riskMeta(r: RiskClass): RiskMeta { return RISK_META[r]; }

// ── Area Safety Score (0-100, higher = safer) ────────────────────────────────
export function safetyScore(distanceCm: number | null, riseRateCmPerMin: number, lowLying: boolean): number {
  if (distanceCm == null) return 88;
  // Distance component: 120cm+ -> ~100, 30cm -> ~0
  let score = Math.max(0, Math.min(100, ((distanceCm - 30) / (120 - 30)) * 100));
  // Penalise rising water (riseRate positive means water rising = distance falling)
  if (riseRateCmPerMin > 0) score -= Math.min(28, riseRateCmPerMin * 9);
  if (lowLying) score -= 6;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function scoreBand(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "Safe",      color: "#1f9d55" };
  if (score >= 40) return { label: "Moderate",  color: "#c98a00" };
  return { label: "High Risk", color: "#d1242f" };
}

// ── Time-to-flood ────────────────────────────────────────────────────────────
// riseRate in cm/min of WATER rise (i.e. distance shrinking). Flood when distance <= 40.
export function timeToFloodMin(distanceCm: number | null, riseRateCmPerMin: number): number | null {
  if (distanceCm == null) return null;
  const FLOOD_AT = 40;
  if (distanceCm <= FLOOD_AT) return 0;
  if (riseRateCmPerMin <= 0.05) return null; // not rising meaningfully
  return Math.round((distanceCm - FLOOD_AT) / riseRateCmPerMin);
}

export function formatTTF(minutes: number | null): string {
  if (minutes == null) return "No Immediate Flood Risk";
  if (minutes <= 0) return "Flooding Now";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} Minute${m !== 1 ? "s" : ""}`;
  if (m === 0) return `${h} Hour${h !== 1 ? "s" : ""}`;
  return `${h} Hour${h !== 1 ? "s" : ""} ${m} Minute${m !== 1 ? "s" : ""}`;
}

// ── Geo helpers ──────────────────────────────────────────────────────────────
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(x));
}

export function travelTimeMin(km: number, kmph = 22): number {
  return Math.max(1, Math.round((km / kmph) * 60));
}

// ── Rise rate estimate from a readings series (cm/min of water rise) ─────────
export function estimateRiseRate(readings: { time: string; distance_cm: number }[]): number {
  if (readings.length < 2) return 0;
  const tail = readings.slice(-8);
  const first = tail[0];
  const last = tail[tail.length - 1];
  const dtMin = (new Date(last.time).getTime() - new Date(first.time).getTime()) / 60000;
  if (dtMin <= 0) return 0;
  // distance shrinking => water rising => positive rise rate
  return (first.distance_cm - last.distance_cm) / dtMin;
}

// ── Deterministic situation summary (Gemini fallback) ────────────────────────
export interface SituationSummary {
  situation: string;
  riskExplanation: string;
  recommendedAction: string;
  recoveryTime: string;
  confidence: string;
}

export function buildSituationSummary(
  areaName: string,
  risk: RiskClass,
  distanceCm: number | null,
  riseRate: number,
  ttfMin: number | null,
): SituationSummary {
  const trend = riseRate > 0.1 ? "increasing gradually" : riseRate < -0.1 ? "receding" : "stable";
  const trendStrong = riseRate > 0.6 ? "rising rapidly" : trend;

  const sit: Record<RiskClass, string> = {
    SAFE: `Flood risk in ${areaName} is currently low. Water levels are ${trend} and well within safe limits. Normal activities can continue.`,
    WATCH: `Flood risk in ${areaName} is currently moderate. Water levels are ${trendStrong}. Residents should avoid parking vehicles in low-lying areas and monitor updates.`,
    WARNING: `Flood risk in ${areaName} is elevated. Water levels are ${trendStrong} and approaching warning thresholds. Residents in low-lying lanes should prepare to move valuables to higher floors.`,
    CRITICAL: `Severe flood risk in ${areaName}. Water levels are critically high and ${trendStrong}. Residents should move to the nearest relief center immediately and avoid all waterlogged routes.`,
  };
  const expl: Record<RiskClass, string> = {
    SAFE: "Drain capacity is sufficient and inflow is balanced. No upstream surge detected.",
    WATCH: "Sensor readings show the channel filling faster than its drainage rate. Continued rainfall could escalate the situation.",
    WARNING: "Drain stress is high — inflow exceeds outflow and the overflow margin is shrinking.",
    CRITICAL: "Drainage capacity has been exceeded. Overflow into streets is imminent or underway.",
  };
  const action: Record<RiskClass, string> = {
    SAFE: "No action needed. Stay informed through official alerts.",
    WATCH: "Avoid low-lying parking, keep emergency contacts handy, and check alerts every 30 minutes.",
    WARNING: "Move vehicles and valuables to higher ground. Identify your nearest safe zone now.",
    CRITICAL: "Evacuate to the nearest relief center using the recommended safe route. Do not enter floodwater.",
  };
  const recovery: Record<RiskClass, string> = {
    SAFE: "Not applicable",
    WATCH: ttfMin ? `~${Math.round((ttfMin + 90) / 60)} hours if rainfall eases` : "3–4 hours after rainfall stops",
    WARNING: "4–6 hours after peak, subject to upstream conditions",
    CRITICAL: "6–10 hours after water recedes below warning level",
  };
  const conf: Record<RiskClass, string> = {
    SAFE: "High (92%)", WATCH: "High (88%)", WARNING: "Moderate (81%)", CRITICAL: "High (90%)",
  };
  void distanceCm;
  return {
    situation: sit[risk],
    riskExplanation: expl[risk],
    recommendedAction: action[risk],
    recoveryTime: recovery[risk],
    confidence: conf[risk],
  };
}

// ── Urban risk score for admin command center (0-100, higher = worse) ────────
export function urbanRiskScore(perNodeDistance: Record<string, number | null>): number {
  const vals = Object.values(perNodeDistance).filter((v): v is number => v != null);
  if (!vals.length) return 18;
  // distance 120 -> 0 risk, 30 -> 100 risk
  const risks = vals.map((d) => Math.max(0, Math.min(100, ((120 - d) / (120 - 30)) * 100)));
  // weight toward the worst node
  const max = Math.max(...risks);
  const avg = risks.reduce((a, b) => a + b, 0) / risks.length;
  return Math.round(0.6 * max + 0.4 * avg);
}

export const ALERT_KIND_LABELS: Record<string, string> = {
  waterlogging: "Waterlogging",
  blocked_drain: "Blocked Drain",
  need_help: "Need Help",
  flooding: "Flooding",
  unsafe_condition: "Unsafe Condition",
};

import type { Level, RiskClass, SewerIndex } from "./types";

// Thresholds mirror .env ALERT_*_CM. Distance is cm from sensor to water:
// LOWER distance = HIGHER water = more dangerous.
export const THRESHOLDS = {
  yellow: 80,
  orange: 60,
  red: 40,
} as const;

export function classify(distanceCm: number): Level {
  if (distanceCm <= THRESHOLDS.red) return "red";
  if (distanceCm <= THRESHOLDS.orange) return "orange";
  if (distanceCm <= THRESHOLDS.yellow) return "yellow";
  return "green";
}

export const LEVEL_COLORS: Record<Level, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
};

export const LEVEL_LABELS: Record<Level, string> = {
  green: "Normal",
  yellow: "Watch",
  orange: "Warning",
  red: "Critical",
};

// Visual mapping for the river: convert distance_cm to a 0..1 water fill
// fraction. minDist (water near sensor) -> full; maxDist -> empty.
const MIN_DIST = 20; // sensor floor (JSN-SR04T spec)
const MAX_DIST = 120; // "empty channel" reference for the animation

export function distanceToFill(distanceCm: number): number {
  const f = (MAX_DIST - distanceCm) / (MAX_DIST - MIN_DIST);
  return Math.max(0, Math.min(1, f));
}

// ── Sewer safety (MQ-4 methane ppm). Mirrors backend config.py defaults. ──────
export const SEWER_THRESHOLDS = {
  caution: 200,
  danger: 500,
  critical: 1000,
} as const;

export function classifySewer(methanePpm: number): SewerIndex {
  if (methanePpm >= SEWER_THRESHOLDS.critical) return "CRITICAL";
  if (methanePpm >= SEWER_THRESHOLDS.danger) return "DANGER";
  if (methanePpm >= SEWER_THRESHOLDS.caution) return "CAUTION";
  return "SAFE";
}

export const SEWER_COLORS: Record<SewerIndex, string> = {
  SAFE: "#22c55e",
  CAUTION: "#eab308",
  DANGER: "#f97316",
  CRITICAL: "#ef4444",
};

export const SEWER_CLEARANCE: Record<SewerIndex, string> = {
  SAFE: "ENTRY ALLOWED",
  CAUTION: "ENTRY RESTRICTED",
  DANGER: "ENTRY PROHIBITED",
  CRITICAL: "ENTRY PROHIBITED",
};

// ── ML flood-risk classes (classifier.py CLASS_LABELS). ───────────────────────
export const RISK_COLORS: Record<RiskClass, string> = {
  SAFE: "#22c55e",
  WATCH: "#eab308",
  WARNING: "#f97316",
  CRITICAL: "#ef4444",
};

// Stress / health categories share the risk palette.
export function stressColor(category: string): string {
  return (RISK_COLORS as Record<string, string>)[category] ?? "#64748b";
}

// Risk score 0–100 → palette (used by the heat map + twin panel).
export function riskScoreColor(score: number): string {
  if (score >= 75) return RISK_COLORS.CRITICAL;
  if (score >= 50) return RISK_COLORS.WARNING;
  if (score >= 25) return RISK_COLORS.WATCH;
  return RISK_COLORS.SAFE;
}

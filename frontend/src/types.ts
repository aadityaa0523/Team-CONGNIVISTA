// Shared types mirroring the FastAPI backend contract (backend/routers/*).

export type Level = "green" | "yellow" | "orange" | "red";

/** Node descriptor for the selector. Coords match backend/services/forecaster._NODE_COORDS. */
export interface NodeInfo {
  id: string;
  label: string;
}

/** GET /readings/{node_id} -> [{ time, distance_cm }] */
export interface Reading {
  time: string; // ISO-8601
  distance_cm: number;
}

/** One step of GET /forecast/{node_id}.forecast */
export interface ForecastStep {
  ts: string; // ISO-8601
  distance_cm_predicted: number;
}

export interface ForecastResponse {
  node_id: string;
  forecast: ForecastStep[];
}

/** Alert document (GET /alerts/{node_id} and WS {type:"alert"}).
 *  Matches alert_engine.evaluate()'s alert_doc shape. */
export interface Alert {
  node_id: string;
  flood_level: Level;
  distance_cm: number;
  forecast_cm?: number | null;
  methane_ppm?: number;
  sewer_safety?: SewerSafety;
  risk_class?: RiskClass;
  time_to_flood_min?: number;
  ts: string;
  briefing?: string;
  sarvam_audio_url?: string;
}

/** Raw water reading pushed over the WebSocket by the MQTT bridge. */
export interface WsReading {
  node_id: string;
  distance_cm: number;
  ts: number; // unix epoch ms
}

/** Methane reading variant pushed over the WebSocket. */
export interface WsMethane {
  node_id: string;
  methane_ppm: number;
  ts: number;
}

/** Alert variant pushed over the WebSocket. */
export interface WsAlert extends Alert {
  type: "alert";
}

export type WsMessage = WsReading | WsMethane | WsAlert;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

// ── Digital twin drain (backend/services/mongo + digital_twin) ────────────────
export interface Drain {
  drain_id: string;
  name?: string;
  location?: { lat: number; lon: number };
  ward?: string;
  capacity_cm?: number;
  overflow_threshold_cm?: number;
  current_water_level_cm?: number;
  fill_pct?: number;
  stress_index?: number;
  stress_category?: string;
  health_score?: number;
  health_label?: string;
  risk_score?: number;
  criticality_score?: number;
  population_served?: number;
  infrastructure_nearby?: string[];
}

export type SewerIndex = "SAFE" | "CAUTION" | "DANGER" | "CRITICAL";

export interface SewerSafety {
  node_id: string;
  sewer_safety_index: SewerIndex;
  worker_clearance: string;
  methane_ppm: number;
}

export type RiskClass = "SAFE" | "WATCH" | "WARNING" | "CRITICAL";

export interface SimulateResult {
  inputs: Record<string, number>;
  fill_pct: number;
  flood_risk: { class: RiskClass; probability: number };
  time_to_flood_min: number;
  recovery_min: number;
  anomaly: { detected: boolean; reason: string };
}

export interface ModelMetrics {
  classifier: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    labels: string[];
    confusion_matrix: number[][];
  };
  ttf_regressor: { rmse_min: number };
  feature_importance: { feature: string; importance: number }[];
  n_train: number;
  n_test: number;
}

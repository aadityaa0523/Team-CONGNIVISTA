import type {
  Alert,
  ChatTurn,
  Drain,
  ForecastResponse,
  ForecastStep,
  ModelMetrics,
  Reading,
  SimulateResult,
} from "./types";

// Relative paths are proxied to the backend by Vite in dev (see vite.config.ts)
// and by nginx in production (Phase 9).
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function fetchReadings(nodeId: string, hours = 6): Promise<Reading[]> {
  return getJson<Reading[]>(`/readings/${encodeURIComponent(nodeId)}?hours=${hours}`);
}

export function fetchForecast(nodeId: string): Promise<ForecastResponse> {
  return getJson<ForecastResponse>(`/forecast/${encodeURIComponent(nodeId)}`);
}

export function fetchAlerts(nodeId: string, limit = 50): Promise<Alert[]> {
  return getJson<Alert[]>(`/alerts/${encodeURIComponent(nodeId)}?limit=${limit}`);
}

export async function trainModel(nodeId: string): Promise<void> {
  const res = await fetch(`/forecast/${encodeURIComponent(nodeId)}/train`, {
    method: "POST",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Train failed: ${res.status} ${detail}`);
  }
}

export function fetchDrains(): Promise<{ drains: Drain[] }> {
  return getJson<{ drains: Drain[] }>(`/drains`);
}

export function fetchModelMetrics(): Promise<ModelMetrics> {
  return getJson<ModelMetrics>(`/model/metrics`);
}

export interface SimulateInput {
  water_level_cm: number;
  capacity_cm: number;
  rise_rate_cm_per_min: number;
  methane_ppm: number;
  rainfall_mm: number;
  hour_of_day: number;
}

export async function runSimulation(input: SimulateInput): Promise<SimulateResult> {
  const res = await fetch("/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Simulate failed: ${res.status}`);
  return res.json() as Promise<SimulateResult>;
}

// ── Community reports ─────────────────────────────────────────────────────────
export interface CommunityReport {
  id: string;
  type: string;
  description: string;
  area: string;
  lat?: number | null;
  lon?: number | null;
  reporter_name?: string;
  reporter_phone?: string;
  severity: string;
  status: string;
  ts: number;
  stored?: string;
}

export async function submitReport(input: {
  type: string;
  description: string;
  area: string;
  lat?: number | null;
  lon?: number | null;
  reporter_name?: string;
  reporter_phone?: string;
  severity?: string;
}): Promise<CommunityReport> {
  const res = await fetch("/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Report failed: ${res.status}`);
  const data = (await res.json()) as { report: CommunityReport };
  return data.report;
}

export function fetchReports(limit = 100): Promise<{ reports: CommunityReport[]; source: string }> {
  return getJson(`/reports?limit=${limit}`);
}

// ── AI situation briefing (Gemini, with deterministic fallback) ───────────────
export interface BriefingResponse {
  node_id: string;
  risk: string;
  trend: string;
  current_distance_cm: number | null;
  forecast: ForecastStep[];
  summary: string;
}

export async function fetchBriefing(nodeId: string): Promise<BriefingResponse> {
  return getJson<BriefingResponse>(`/ai/briefing/${encodeURIComponent(nodeId)}`);
}

export interface AnalysisResponse {
  node_id: string;
  summary: string;
  risk_explanation: string;
  root_cause: string[];
  recommendations: string[];
}

export function fetchAnalysis(nodeId: string): Promise<AnalysisResponse> {
  return getJson<AnalysisResponse>(`/ai/analysis/${encodeURIComponent(nodeId)}`);
}

export interface ChatResponse {
  response: string;
  translated: boolean;
}

export async function sendChat(
  message: string,
  history: ChatTurn[],
  nodeId: string,
  lang: string,
): Promise<ChatResponse> {
  const res = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, node_id: nodeId, lang }),
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  return res.json() as Promise<ChatResponse>;
}

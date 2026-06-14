import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ChevronRight,
  CircleDot,
  Database,
  Droplets,
  Gauge,
  LayoutDashboard,
  Map as MapIcon,
  Radio,
  RefreshCw,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  TrendingUp,
  Waves,
  Wifi,
  WifiOff,
} from "lucide-react";

import RiverAnimation from "./components/RiverAnimation";
import DrainAnimation from "./components/DrainAnimation";
import ForecastChart from "./components/ForecastChart";
import AlertPanel from "./components/AlertPanel";
import ChatCopilot from "./components/ChatCopilot";
import DrainTwinPanel from "./components/DrainTwinPanel";
import SewerSafetyPanel from "./components/SewerSafetyPanel";
import FloodHeatMap from "./components/FloodHeatMap";
import ModelDashboard from "./components/ModelDashboard";
import WhatIfSimulator from "./components/WhatIfSimulator";
import FloodReplayTimeline from "./components/FloodReplayTimeline";
import HistoricalTrends from "./components/HistoricalTrends";
import { useWebSocket } from "./hooks/useWebSocket";
import {
  fetchAlerts,
  fetchDrains,
  fetchForecast,
  fetchReadings,
  trainModel,
} from "./api";
import type { Alert, Drain, ForecastStep, Reading } from "./types";
import { LEVEL_COLORS, LEVEL_LABELS, classify } from "./levels";

// ── River nodes (coords mirror backend/services/forecaster._NODE_COORDS) ──────
const RIVER_NODES = [
  { id: "krishna_river_01",  label: "Krishna River",    location: "Vijayawada, AP",   lat: 16.5062, lng: 80.6480 },
  { id: "godavari_river_01", label: "Godavari River",   location: "Rajahmundry, AP",  lat: 17.0005, lng: 81.8040 },
  { id: "hussain_sagar_01",  label: "Hussain Sagar",    location: "Hyderabad, TG",    lat: 17.4239, lng: 78.4738 },
];

type Page =
  | "command" | "twin"  | "live"
  | "flood"   | "sewer" | "map"  | "whatif"
  | "incidents" | "analytics" | "model" | "alerts"
  | "district" | "settings";

interface NodeOption {
  id: string;
  label: string;
  location?: string;
  kind: "river" | "drain";
}

const NAV: { key: Page; label: string; icon: React.ElementType; group: string }[] = [
  { key: "command",   label: "Command Center",    icon: LayoutDashboard,   group: "Operations"     },
  { key: "twin",      label: "Digital Twin",       icon: Boxes,             group: "Operations"     },
  { key: "live",      label: "Live Monitoring",    icon: Activity,          group: "Operations"     },
  { key: "flood",     label: "Flood Intelligence", icon: Waves,             group: "Intelligence"   },
  { key: "sewer",     label: "Sewer Safety",       icon: ShieldAlert,       group: "Intelligence"   },
  { key: "map",       label: "Risk Map",            icon: MapIcon,           group: "Intelligence"   },
  { key: "whatif",    label: "What-If Simulator",  icon: SlidersHorizontal, group: "Intelligence"   },
  { key: "incidents", label: "Incident Center",    icon: AlertTriangle,     group: "Records"        },
  { key: "analytics", label: "Analytics",          icon: BarChart3,         group: "Records"        },
  { key: "model",     label: "Model Evaluation",   icon: Gauge,             group: "Records"        },
  { key: "alerts",    label: "Alerts",             icon: Bell,              group: "Records"        },
  { key: "district",  label: "District View",      icon: Building2,         group: "Administration" },
  { key: "settings",  label: "Settings & Admin",   icon: Settings,          group: "Administration" },
];

const GROUPS = ["Operations", "Intelligence", "Records", "Administration"];

// ── Inline section components ─────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="section-header">
      <h1 className="section-title">{title}</h1>
      {sub && <p className="section-sub">{sub}</p>}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className="kv-val">{v}</span>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  accent = "var(--accent)",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  unit?: string;
  accent?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ color: accent, background: accent + "1a" }}>
        <Icon size={16} />
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
    </div>
  );
}

// ── District View ─────────────────────────────────────────────────────────────

function DistrictView({
  alerts,
  readings,
  nodeId,
}: {
  alerts: Alert[];
  readings: Reading[];
  liveDistance?: number | null;
  nodeId: string;
}) {
  const nodeAlerts = (id: string) => alerts.filter((a) => a.node_id === id);
  const districtNodes = [
    { id: "krishna_river_01",  label: "Krishna River",  location: "Vijayawada",   district: "Krishna, AP",      pop: "1.2M" },
    { id: "godavari_river_01", label: "Godavari River", location: "Rajahmundry",  district: "East Godavari, AP", pop: "890K" },
    { id: "hussain_sagar_01",  label: "Hussain Sagar",  location: "Hyderabad",    district: "Rangareddy, TG",   pop: "3.1M" },
  ];

  return (
    <div className="page-content">
      <SectionHeader
        title="District View"
        sub="AP · TG river basin monitoring — population exposure and alert status"
      />

      <div className="stat-strip">
        <StatCard icon={Radio}         label="Active Nodes"       value={RIVER_NODES.length} accent="#38bdf8" />
        <StatCard icon={AlertTriangle} label="Active Alerts"      value={alerts.filter((a) => a.flood_level !== "green").length} accent="#ef4444" />
        <StatCard icon={TrendingUp}    label="Readings (6h)"      value={readings.length} accent="#a855f7" />
        <StatCard icon={Building2}     label="Districts Covered"  value={2} unit=" states" accent="#22c55e" />
      </div>

      <div className="district-grid">
        {districtNodes.map((n) => {
          const nodeAlert = nodeAlerts(n.id);
          const latest = nodeAlert[0];
          const level = latest?.flood_level ?? "green";
          const color = LEVEL_COLORS[level];
          const isActive = n.id === nodeId;
          return (
            <div
              key={n.id}
              className={`district-card ${isActive ? "district-card--active" : ""}`}
              style={{ borderColor: isActive ? color : undefined }}
            >
              <div className="district-card-head">
                <span className="district-dot" style={{ background: color }} />
                <div>
                  <div className="district-name">{n.label}</div>
                  <div className="district-loc">{n.location} · {n.district}</div>
                </div>
                <span
                  className="level-badge"
                  style={{ background: color, marginLeft: "auto" }}
                >
                  {LEVEL_LABELS[level]}
                </span>
              </div>
              <div className="district-meta">
                <KV k="Population at risk" v={n.pop} />
                <KV k="Alerts (recent)"    v={String(nodeAlert.length)} />
                <KV k="Node ID"            v={n.id} />
                {latest && <KV k="Last alert"       v={new Date(latest.ts).toLocaleString()} />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="district-card" style={{ marginTop: 18 }}>
        <div className="district-name" style={{ marginBottom: 12 }}>State Coverage</div>
        {[
          { state: "Andhra Pradesh", nodes: 2, rivers: "Krishna, Godavari", agency: "AP SDMA" },
          { state: "Telangana",      nodes: 1, rivers: "Hussain Sagar",     agency: "TSSDMA"  },
        ].map((s) => (
          <div key={s.state} className="kv-row" style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <span className="kv-key">{s.state}</span>
            <span className="kv-val" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              <span>{s.nodes} node{s.nodes > 1 ? "s" : ""} · {s.rivers}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Partner: {s.agency}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Settings View ─────────────────────────────────────────────────────────────

function SettingsView({ wsStatus }: { wsStatus: string }) {
  const integrations = [
    { name: "Sarvam AI",       desc: "Telugu TTS · Translate · Chat copilot",    key: "SARVAM_API_KEY"         },
    { name: "Gemini API",      desc: "AI flood briefings · Multimodal analysis",  key: "GEMINI_API_KEY"         },
    { name: "OpenWeatherMap",  desc: "Rainfall exogenous for ARIMAX model",       key: "OWM_API_KEY"            },
    { name: "Twilio",          desc: "SMS · Voice call alerts",                   key: "TWILIO_ACCOUNT_SID"     },
    { name: "InfluxDB",        desc: "Time-series readings storage",              key: "INFLUX_TOKEN"           },
    { name: "MongoDB Atlas",   desc: "Alert docs · drain metadata",               key: "MONGO_URI"              },
    { name: "MQTT Broker",     desc: "Mosquitto · paho-mqtt subscriber",          key: "MQTT_BROKER_HOST"       },
  ];

  return (
    <div className="page-content">
      <SectionHeader title="Settings & Admin" sub="API integrations · MQTT config · alert thresholds" />

      <div className="settings-grid">
        <div className="settings-panel">
          <div className="settings-panel-title">API Integrations</div>
          <div className="settings-panel-sub">Keys loaded from .env — stored server-side</div>
          {integrations.map((s) => (
            <div key={s.name} className="settings-row">
              <Database size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
              <div className="settings-row-body">
                <div className="settings-row-name">{s.name}</div>
                <div className="settings-row-desc">{s.desc}</div>
              </div>
              <code className="settings-key-pill">{s.key}</code>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="settings-panel">
            <div className="settings-panel-title">Alert Thresholds</div>
            <div className="settings-panel-sub">Distance (cm) from sensor to water — lower = higher water</div>
            {[
              { label: "Watch",    env: "ALERT_YELLOW_CM", val: "80 cm", color: "#eab308" },
              { label: "Warning",  env: "ALERT_ORANGE_CM", val: "60 cm", color: "#f97316" },
              { label: "Critical", env: "ALERT_RED_CM",    val: "40 cm", color: "#ef4444" },
            ].map((t) => (
              <div key={t.label} className="kv-row" style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <span className="kv-key" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <CircleDot size={11} color={t.color} />
                  {t.label} ({t.env})
                </span>
                <span className="kv-val" style={{ color: t.color }}>{t.val}</span>
              </div>
            ))}
          </div>

          <div className="settings-panel">
            <div className="settings-panel-title">Device & Data</div>
            <KV k="Firmware"          v="ESP32 + JSN-SR04T" />
            <KV k="Publish interval"  v="30 000 ms" />
            <KV k="MQTT topic"        v="hydromind/waterlevel/#" />
            <KV k="Forecast horizon"  v="2 hours (ARIMAX)" />
            <KV k="Forecast model"    v="ARIMAX(2,1,2)" />
            <KV k="WebSocket"         v={wsStatus} />
            <KV k="Alert language"    v="Telugu (Sarvam AI)" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Live Monitoring View ──────────────────────────────────────────────────────

function LiveMonitoringView({
  node,
  liveDistance,
  readings,
  wsStatus,
}: {
  node: NodeOption | null;
  liveDistance: number | null;
  readings: Reading[];
  wsStatus: string;
}) {
  const level = liveDistance != null ? classify(liveDistance) : null;
  const color = level ? LEVEL_COLORS[level] : "var(--muted)";
  const label = level ? LEVEL_LABELS[level] : "—";
  const last6 = readings.slice(-12);
  const riseRate = useMemo(() => {
    if (last6.length < 2) return null;
    const first = last6[0].distance_cm;
    const last  = last6[last6.length - 1].distance_cm;
    const deltaMin = (last6.length - 1) * 0.5; // 30s intervals → 0.5 min each
    return deltaMin > 0 ? ((first - last) / deltaMin).toFixed(2) : null;
  }, [last6]);

  return (
    <div className="page-content">
      <SectionHeader
        title="Live Monitoring"
        sub={`Streaming telemetry · ${node?.label ?? "—"} · ${node?.location ?? ""}`}
      />

      <div className="stat-strip">
        <StatCard icon={Droplets}   label="Distance to water" value={liveDistance?.toFixed(1) ?? "—"} unit=" cm"     accent={color} />
        <StatCard icon={TrendingUp} label="Rise rate (est.)"  value={riseRate ?? "—"}              unit=" cm/min"    accent="#a855f7" />
        <StatCard icon={Waves}      label="Alert level"       value={label}                                           accent={color} />
        <StatCard icon={Radio}      label="WebSocket"         value={wsStatus}                                        accent={wsStatus === "open" ? "#22c55e" : "#ef4444"} />
      </div>

      <div className="live-grid">
        <div className="river-card">
          <div className="river-header">
            <div>
              <h3>{node?.label ?? "No node selected"}</h3>
              <span className="river-sub">Real-time cross-section · updates on MQTT publish</span>
            </div>
            {level && (
              <span className="level-badge" style={{ background: color }}>{label}</span>
            )}
          </div>
          <RiverAnimation nodeLabel={node?.label ?? ""} distanceCm={liveDistance} />
        </div>

        <div className="live-recent">
          <div className="settings-panel-title" style={{ marginBottom: 12 }}>Recent Readings</div>
          {last6.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>No readings yet — publish sensor data via MQTT.</div>
          ) : (
            <div className="live-table">
              <div className="live-table-head">
                <span>Time</span>
                <span>Distance (cm)</span>
                <span>Level</span>
              </div>
              {[...last6].reverse().map((r, i) => {
                const lvl = classify(r.distance_cm);
                return (
                  <div key={i} className="live-table-row">
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>
                      {new Date(r.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {r.distance_cm.toFixed(1)}
                    </span>
                    <span className="level-badge" style={{ background: LEVEL_COLORS[lvl], fontSize: 10 }}>
                      {LEVEL_LABELS[lvl]}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Flood Intelligence View ───────────────────────────────────────────────────

function FloodIntelligenceView({
  readings,
  forecast,
  loading,
  error,
}: {
  readings: Reading[];
  forecast: ForecastStep[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="page-content">
      <SectionHeader
        title="Flood Intelligence"
        sub="ARIMAX(2,1,2) · 2-hour forecast · OpenWeatherMap rainfall as exogenous input"
      />

      <div className="stat-strip">
        <StatCard icon={TrendingUp} label="Model"           value="ARIMAX(2,1,2)"   accent="#a855f7" />
        <StatCard icon={Waves}      label="Forecast horizon" value="2"  unit=" hours" accent="#38bdf8" />
        <StatCard icon={Droplets}   label="Exogenous input"  value="Rainfall (OWM)"  accent="#22c55e" />
        <StatCard icon={Gauge}      label="Retrain cadence"  value="APScheduler"     accent="#f97316" />
      </div>

      <div className="chart-card" style={{ minHeight: 380 }}>
        <ForecastChart readings={readings} forecast={forecast} loading={loading} error={error} />
      </div>

      <div className="flood-meta-grid">
        <div className="settings-panel">
          <div className="settings-panel-title">Model Parameters</div>
          <KV k="Order"             v="ARIMAX(2, 1, 2)" />
          <KV k="AR terms (p)"      v="2" />
          <KV k="Differencing (d)"  v="1" />
          <KV k="MA terms (q)"      v="2" />
          <KV k="Exogenous"         v="rainfall_mm (OpenWeatherMap)" />
          <KV k="Forecast steps"    v="4 × 30 min = 2 h" />
          <KV k="Retrain trigger"   v="APScheduler periodic job" />
        </div>
        <div className="settings-panel">
          <div className="settings-panel-title">Alert Thresholds (distance cm)</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>
            Lower distance = higher water surface. Thresholds apply to both current reading and 2-h forecast.
          </div>
          {[
            { level: "Watch",    cm: "≤ 80",  color: "#eab308" },
            { level: "Warning",  cm: "≤ 60",  color: "#f97316" },
            { level: "Critical", cm: "≤ 40",  color: "#ef4444" },
            { level: "Safe",     cm: "> 80",  color: "#22c55e" },
          ].map((t) => (
            <div key={t.level} className="kv-row" style={{ padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
              <span className="kv-key" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <CircleDot size={10} color={t.color} />{t.level}
              </span>
              <span className="kv-val" style={{ color: t.color, fontVariantNumeric: "tabular-nums" }}>{t.cm} cm</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage]   = useState<Page>("command");
  const [drains, setDrains] = useState<Drain[]>([]);
  const [nodeId, setNodeId] = useState(RIVER_NODES[0].id);

  const [readings,    setReadings]    = useState<Reading[]>([]);
  const [forecast,    setForecast]    = useState<ForecastStep[]>([]);
  const [restAlerts,  setRestAlerts]  = useState<Alert[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [training,    setTraining]    = useState(false);

  const ws = useWebSocket();

  useEffect(() => {
    fetchDrains()
      .then((r) => setDrains(r.drains ?? []))
      .catch(() => setDrains([]));
  }, []);

  const nodes: NodeOption[] = useMemo(() => {
    const river: NodeOption[] = RIVER_NODES.map((n) => ({ ...n, kind: "river" }));
    const drain: NodeOption[] = drains.map((d) => ({
      id: d.drain_id,
      label: d.name ?? d.drain_id,
      location: d.ward,
      kind: "drain",
    }));
    return [...river, ...drain];
  }, [drains]);

  const current       = useMemo(() => nodes.find((n) => n.id === nodeId) ?? nodes[0], [nodes, nodeId]);
  const selectedDrain = useMemo(() => drains.find((d) => d.drain_id === nodeId) ?? null, [drains, nodeId]);

  const loadData = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    const [r, f, a] = await Promise.allSettled([
      fetchReadings(id, 6),
      fetchForecast(id),
      fetchAlerts(id, 50),
    ]);
    setReadings(r.status === "fulfilled" ? r.value : []);
    setForecast(f.status === "fulfilled" ? f.value.forecast : []);
    setRestAlerts(a.status === "fulfilled" ? a.value : []);
    if (f.status === "rejected") setError("No trained model yet — click Train Model.");
    setLoading(false);
  }, []);

  useEffect(() => { loadData(nodeId); }, [nodeId, loadData]);

  const liveReading  = ws.latest[nodeId];
  const liveDistance =
    liveReading?.distance_cm ??
    (readings.length ? readings[readings.length - 1].distance_cm : null);
  const liveMethane  = ws.methane[nodeId] ?? null;

  const drainFill = useMemo(() => {
    if (current?.kind !== "drain") return null;
    const cap = selectedDrain?.capacity_cm ?? 100;
    if (liveDistance != null && cap > 0)
      return Math.max(0, Math.min(100, (liveDistance / cap) * 100));
    return selectedDrain?.fill_pct ?? null;
  }, [current, selectedDrain, liveDistance]);

  const mergedReadings = useMemo(() => {
    if (!liveReading) return readings;
    const liveIso = new Date(liveReading.ts).toISOString();
    if (readings.some((r) => r.time === liveIso)) return readings;
    return [...readings, { time: liveIso, distance_cm: liveReading.distance_cm }];
  }, [readings, liveReading]);

  const combinedAlerts = useMemo(() => {
    const live = ws.alerts.filter((a) => a.node_id === nodeId);
    const seen = new Set(live.map((a) => a.ts));
    return [...live, ...restAlerts.filter((a) => !seen.has(a.ts))].slice(0, 50);
  }, [ws.alerts, restAlerts, nodeId]);

  const handleTrain = async () => {
    setTraining(true);
    setError(null);
    try {
      await trainModel(nodeId);
      await loadData(nodeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Training failed.");
    } finally {
      setTraining(false);
    }
  };

  // Derive current node's alert level for sidebar indicator
  const currentLevel = liveDistance != null ? classify(liveDistance) : null;
  const currentColor = currentLevel ? LEVEL_COLORS[currentLevel] : "var(--muted)";

  const groups = GROUPS;

  function renderPage() {
    switch (page) {
      case "command":
        return (
          <main className="grid">
            <section className="cell river">
              {current?.kind === "drain" ? (
                <DrainAnimation
                  drainName={current.label}
                  fillPct={drainFill}
                  stressCategory={selectedDrain?.stress_category}
                />
              ) : (
                <RiverAnimation nodeLabel={current?.label ?? nodeId} distanceCm={liveDistance} />
              )}
            </section>
            <section className="cell forecast">
              <ForecastChart readings={mergedReadings} forecast={forecast} loading={loading} error={error} />
            </section>
            <section className="cell twin">
              <DrainTwinPanel drain={selectedDrain} />
            </section>
            <section className="cell sewer">
              <SewerSafetyPanel methanePpm={liveMethane} />
            </section>
            <section className="cell alerts">
              <AlertPanel alerts={combinedAlerts} />
            </section>
            <section className="cell copilot">
              <ChatCopilot nodeId={nodeId} />
            </section>
            <section className="cell map">
              <FloodHeatMap drains={drains} onSelect={setNodeId} />
            </section>
          </main>
        );

      case "twin":
        return (
          <div className="tab-panel">
            <SectionHeader
              title="Digital Twin"
              sub="Drain and river asset model · physical metadata from MongoDB"
            />
            <div className="twin-full">
              <DrainTwinPanel drain={selectedDrain} />
            </div>
          </div>
        );

      case "live":
        return (
          <LiveMonitoringView
            node={current}
            liveDistance={liveDistance}
            readings={mergedReadings}
            wsStatus={ws.status}
          />
        );

      case "flood":
        return (
          <FloodIntelligenceView
            readings={mergedReadings}
            forecast={forecast}
            loading={loading}
            error={error}
          />
        );

      case "sewer":
        return (
          <div className="tab-panel">
            <SectionHeader
              title="Sewer Safety"
              sub="MQ-4 methane monitoring · worker entry clearance · JSN-SR04T sensor health"
            />
            <SewerSafetyPanel methanePpm={liveMethane} />
          </div>
        );

      case "map":
        return (
          <div className="tab-panel">
            <SectionHeader
              title="Risk Map"
              sub="Drain heat map · click node to select · risk score overlay"
            />
            <div style={{ height: "calc(100vh - 200px)", minHeight: 500 }}>
              <FloodHeatMap drains={drains} onSelect={(id) => { setNodeId(id); setPage("command"); }} />
            </div>
          </div>
        );

      case "whatif":
        return (
          <div className="tab-panel">
            <SectionHeader
              title="What-If Simulator"
              sub="Stress-test the ML model under hypothetical rainfall and fill conditions"
            />
            <WhatIfSimulator />
          </div>
        );

      case "incidents":
        return (
          <div className="tab-panel">
            <SectionHeader
              title="Incident Center"
              sub="Flood replay timeline · scrub through historical alert events"
            />
            <FloodReplayTimeline alerts={combinedAlerts} nodeId={nodeId} />
          </div>
        );

      case "analytics":
        return (
          <div className="tab-panel">
            <SectionHeader
              title="Analytics"
              sub="Historical trends · alert frequency · level distribution over time"
            />
            <HistoricalTrends alerts={combinedAlerts} nodeId={nodeId} />
          </div>
        );

      case "model":
        return (
          <div className="tab-panel">
            <SectionHeader
              title="Model Evaluation"
              sub="ARIMAX accuracy · confusion matrix · feature importance"
            />
            <ModelDashboard />
          </div>
        );

      case "alerts":
        return (
          <div className="tab-panel">
            <SectionHeader
              title="Alerts"
              sub="Live alert feed · Sarvam AI Telugu TTS · Twilio SMS dispatch"
            />
            <div style={{ maxWidth: 780 }}>
              <AlertPanel alerts={combinedAlerts} />
            </div>
          </div>
        );

      case "district":
        return (
          <DistrictView
            alerts={combinedAlerts}
            readings={mergedReadings}
            liveDistance={liveDistance}
            nodeId={nodeId}
          />
        );

      case "settings":
        return <SettingsView wsStatus={ws.status} />;

      default:
        return null;
    }
  }

  return (
    <div className="app-shell">
      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <Waves size={20} color="#fff" />
          </div>
          <div>
            <div className="sidebar-title">HydroMind<span className="sidebar-title-accent"> Sentinel</span></div>
            <div className="sidebar-tagline">Flood Early Warning · AP · TG</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div key={group} className="sidebar-group">
              <div className="sidebar-group-label">{group}</div>
              {NAV.filter((n) => n.group === group).map((n) => {
                const active = page === n.key;
                return (
                  <button
                    key={n.key}
                    className={`sidebar-item ${active ? "sidebar-item--active" : ""}`}
                    onClick={() => setPage(n.key)}
                  >
                    <n.icon size={16} />
                    <span className="sidebar-item-label">{n.label}</span>
                    {n.key === "command" && currentLevel && currentLevel !== "green" && (
                      <span
                        className="sidebar-alert-dot"
                        style={{ background: currentColor }}
                      />
                    )}
                    {n.key === "alerts" && combinedAlerts.length > 0 && (
                      <span className="sidebar-badge">{combinedAlerts.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Active node pill */}
        <div className="sidebar-foot">
          <div className="sidebar-foot-node">
            <CircleDot size={10} color={currentColor} />
            <span className="sidebar-foot-label">{current?.label ?? nodeId}</span>
          </div>
          <div className="sidebar-foot-sub">
            {current?.location ?? "—"} · v1.0
          </div>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <div className="main-area">
        {/* Header */}
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <Waves size={16} color="var(--accent)" />
            <ChevronRight size={13} color="var(--muted)" />
            <span className="topbar-page">{NAV.find((n) => n.key === page)?.label ?? "—"}</span>
            {currentLevel && currentLevel !== "green" && (
              <span
                className="level-badge"
                style={{ background: LEVEL_COLORS[currentLevel], marginLeft: 8 }}
              >
                {LEVEL_LABELS[currentLevel]}
              </span>
            )}
          </div>

          <div className="topbar-controls">
            <select
              className="node-select"
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
            >
              <optgroup label="Rivers">
                {nodes.filter((n) => n.kind === "river").map((n) => (
                  <option key={n.id} value={n.id}>{n.label}</option>
                ))}
              </optgroup>
              {nodes.some((n) => n.kind === "drain") && (
                <optgroup label="Drains">
                  {nodes.filter((n) => n.kind === "drain").map((n) => (
                    <option key={n.id} value={n.id}>{n.label}</option>
                  ))}
                </optgroup>
              )}
            </select>

            <button className="btn" onClick={handleTrain} disabled={training}>
              <RefreshCw size={14} className={training ? "spin" : ""} />
              {training ? "Training…" : "Train ARIMAX"}
            </button>

            <span className={`ws-status ${ws.status}`}>
              {ws.status === "open" ? <Wifi size={14} /> : <WifiOff size={14} />}
              {ws.status}
            </span>
          </div>
        </header>

        {/* Page content */}
        <div className="main-scroll">
          {renderPage()}
        </div>
      </div>
    </div>
  );
}

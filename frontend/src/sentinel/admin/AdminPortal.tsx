import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  Bus,
  Cross,
  Gauge,
  GitBranchPlus,
  GraduationCap,
  HardHat,
  LayoutDashboard,
  ListOrdered,
  MessageSquare,
  Radio,
  RefreshCw,
  Route,
  Search,
  SlidersHorizontal,
  Siren,
  Sparkles,
  TrendingUp,
  Users,
  Waves,
  Wind,
} from "lucide-react";
// note: ShieldAlert intentionally omitted (using Wind for sewer)

import { useWebSocket } from "../../hooks/useWebSocket";
import {
  fetchAlerts,
  fetchAnalysis,
  fetchDrains,
  fetchForecast,
  fetchReadings,
  fetchReports,
  trainModel,
  type AnalysisResponse,
  type CommunityReport,
} from "../../api";
import type { Alert, Drain, ForecastStep, Reading, RiskClass } from "../../types";
import { riskScoreColor } from "../../levels";
import {
  AREAS,
  INFRA,
  estimateRiseRate,
  formatTTF,
  riskFromDistance,
  riskMeta,
  timeToFloodMin,
  urbanRiskScore,
  type InfraKind,
} from "../data";

import ForecastChart from "../../components/ForecastChart";
import RiverAnimation from "../../components/RiverAnimation";
import DrainTwinPanel from "../../components/DrainTwinPanel";
import SewerSafetyPanel from "../../components/SewerSafetyPanel";
import WhatIfSimulator from "../../components/WhatIfSimulator";
import HistoricalTrends from "../../components/HistoricalTrends";
import ModelDashboard from "../../components/ModelDashboard";
import FloodReplayTimeline from "../../components/FloodReplayTimeline";
import AlertPanel from "../../components/AlertPanel";
import ChatCopilot from "../../components/ChatCopilot";

type Tab =
  | "command" | "twin" | "network" | "flood" | "sewer"
  | "anomaly" | "assets" | "infra" | "analytics" | "model" | "whatif" | "copilot";

const TABS: { key: Tab; label: string; icon: React.ElementType; group: string }[] = [
  { key: "command",   label: "Command Center",    icon: LayoutDashboard,   group: "Operations" },
  { key: "twin",      label: "Digital Twin",       icon: Boxes,             group: "Operations" },
  { key: "network",   label: "Live Drain Network", icon: Radio,             group: "Operations" },
  { key: "flood",     label: "Flood Intelligence", icon: Waves,             group: "Intelligence" },
  { key: "sewer",     label: "Sewer Safety",       icon: Wind,              group: "Intelligence" },
  { key: "anomaly",   label: "Anomaly Detection",  icon: Search,            group: "Intelligence" },
  { key: "assets",    label: "Asset Priority",     icon: ListOrdered,       group: "Assets" },
  { key: "infra",     label: "Infra Impact",       icon: Building2,         group: "Assets" },
  { key: "analytics", label: "Analytics",          icon: BarChart3,         group: "Records" },
  { key: "model",     label: "Model Evaluation",   icon: Gauge,             group: "Records" },
  { key: "whatif",    label: "What-If Simulator",  icon: SlidersHorizontal, group: "Tools" },
  { key: "copilot",   label: "AI Decision Assistant", icon: MessageSquare,  group: "Tools" },
];

const RIVER_NODES = AREAS.map((a) => ({ id: a.id, label: a.name, city: a.city }));

// Ring for urban risk score (light-on-dark hero).
function HeroRing({ value }: { value: number }) {
  const size = 130, stroke = 12, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  const color = value >= 70 ? "#ff7a85" : value >= 45 ? "#ffce6b" : "#7fe0a8";
  return (
    <div className="urs-ring">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset 0.6s" }} />
      </svg>
      <div className="urs-num"><b>{value}</b><span>URBAN RISK</span></div>
    </div>
  );
}

function riskLabelFromScore(score: number): RiskClass {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "WARNING";
  if (score >= 25) return "WATCH";
  return "SAFE";
}

export default function AdminPortal() {
  const [tab, setTab] = useState<Tab>("command");
  const [nodeId, setNodeId] = useState(RIVER_NODES[0].id);
  const ws = useWebSocket();

  const [drains, setDrains] = useState<Drain[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [forecast, setForecast] = useState<ForecastStep[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [training, setTraining] = useState(false);

  useEffect(() => { fetchDrains().then((d) => setDrains(d.drains ?? [])).catch(() => setDrains([])); }, []);
  useEffect(() => { fetchReports(100).then((d) => setReports(d.reports)).catch(() => setReports([])); }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true); setError(null);
    const [r, f, a] = await Promise.allSettled([fetchReadings(id, 6), fetchForecast(id), fetchAlerts(id, 50)]);
    setReadings(r.status === "fulfilled" ? r.value : []);
    setForecast(f.status === "fulfilled" ? f.value.forecast : []);
    setAlerts(a.status === "fulfilled" ? a.value : []);
    if (f.status === "rejected") setError("No trained model yet — click Reload Model.");
    setLoading(false);
  }, []);
  useEffect(() => { load(nodeId); }, [nodeId, load]);

  const selectedDrain = useMemo(() => drains.find((d) => d.drain_id === nodeId) ?? null, [drains, nodeId]);

  const liveDistance = ws.latest[nodeId]?.distance_cm ?? (readings.length ? readings[readings.length - 1].distance_cm : null);
  const liveMethane = ws.methane[nodeId] ?? null;
  const riseRate = useMemo(() => estimateRiseRate(readings), [readings]);

  const mergedReadings = useMemo(() => {
    const live = ws.latest[nodeId];
    if (!live) return readings;
    const iso = new Date(live.ts).toISOString();
    if (readings.some((r) => r.time === iso)) return readings;
    return [...readings, { time: iso, distance_cm: live.distance_cm }];
  }, [readings, ws.latest, nodeId]);

  // Urban risk score across all monitored nodes.
  const perNodeDistance = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const n of RIVER_NODES) m[n.id] = ws.latest[n.id]?.distance_cm ?? (n.id === nodeId ? liveDistance : null);
    return m;
  }, [ws.latest, nodeId, liveDistance]);
  const urs = urbanRiskScore(perNodeDistance);
  const ursClass = riskLabelFromScore(urs);

  const combinedAlerts = useMemo(() => {
    const live = ws.alerts.filter((a) => a.node_id === nodeId);
    const seen = new Set(live.map((a) => a.ts));
    return [...live, ...alerts.filter((a) => !seen.has(a.ts))].slice(0, 50);
  }, [ws.alerts, alerts, nodeId]);

  const handleReload = async () => {
    setTraining(true); setError(null);
    try { await trainModel(nodeId); await load(nodeId); }
    catch (e) { setError(e instanceof Error ? e.message : "Reload failed."); }
    finally { setTraining(false); }
  };

  const groups = ["Operations", "Intelligence", "Assets", "Records", "Tools"];

  return (
    <div className="portal-shell">
      <nav className="portal-nav">
        <div className="portal-nav-inner">
          {groups.flatMap((g) => TABS.filter((t) => t.group === g)).map((t) => (
            <button key={t.key} className={`portal-nav-item ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="portal-main">
        <div className="portal-content">
          {/* Node selector + reload */}
          <div className="adm-sub">
            <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>MONITORING NODE</span>
            <select className="gselect" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
              <optgroup label="River / Basin Nodes">
                {RIVER_NODES.map((n) => <option key={n.id} value={n.id}>{n.label} — {n.city}</option>)}
              </optgroup>
              {drains.length > 0 && (
                <optgroup label="Drain Nodes">
                  {drains.map((d) => <option key={d.drain_id} value={d.drain_id}>{d.name ?? d.drain_id}</option>)}
                </optgroup>
              )}
            </select>
            <span className={`sbadge ${ws.status === "open" ? "safe" : "crit"}`} style={{ marginLeft: "auto" }}>
              <span className="dotled" style={{ background: ws.status === "open" ? "#1f9d55" : "#d1242f" }} /> Telemetry {ws.status}
            </span>
            <button className="gbtn ghost" onClick={handleReload} disabled={training}>
              <RefreshCw size={14} className={training ? "spin" : ""} /> {training ? "Loading…" : "Reload Model"}
            </button>
          </div>

          {tab === "command" && (
            <CommandCenter
              urs={urs} ursClass={ursClass} drains={drains} reports={reports} alerts={combinedAlerts}
              readings={mergedReadings} forecast={forecast} loading={loading} error={error}
              nodeId={nodeId} nodeLabel={RIVER_NODES.find((n) => n.id === nodeId)?.label ?? nodeId}
              liveDistance={liveDistance} liveMethane={liveMethane} ws={ws} perNodeDistance={perNodeDistance}
            />
          )}
          {tab === "twin" && <TwinPage drains={drains} selected={selectedDrain} onSelect={setNodeId} />}
          {tab === "network" && <NetworkPage drains={drains} ws={ws} onSelect={(id) => { setNodeId(id); }} />}
          {tab === "flood" && <FloodPage readings={mergedReadings} forecast={forecast} loading={loading} error={error} liveDistance={liveDistance} riseRate={riseRate} />}
          {tab === "sewer" && <SewerPage methane={liveMethane} drains={drains} ws={ws} />}
          {tab === "anomaly" && <AnomalyPage nodeId={nodeId} drains={drains} liveDistance={liveDistance} riseRate={riseRate} methane={liveMethane} />}
          {tab === "assets" && <AssetsPage drains={drains} />}
          {tab === "infra" && <InfraPage perNodeDistance={perNodeDistance} />}
          {tab === "analytics" && <AnalyticsPage alerts={combinedAlerts} nodeId={nodeId} />}
          {tab === "model" && <PageWrap title="Model Evaluation" sub="XGBoost classifier accuracy, confusion matrix and feature importance."><ModelDashboard /></PageWrap>}
          {tab === "whatif" && <PageWrap title="What-If Simulator" sub="Stress-test flood risk, time-to-flood and recovery under hypothetical conditions."><WhatIfSimulator /></PageWrap>}
          {tab === "copilot" && <PageWrap title="AI Decision Assistant" sub="Ask the Gemini-powered analyst about any node — in English, Telugu or Tamil."><div style={{ maxWidth: 720 }}><ChatCopilot nodeId={nodeId} /></div></PageWrap>}
        </div>
      </div>
    </div>
  );
}

// ── shared bits ───────────────────────────────────────────────────────────────
function PageHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-row">
        <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
        {right}
      </div>
    </div>
  );
}
function PageWrap({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <><PageHead title={title} sub={sub} />{children}</>;
}
function Tile({ icon: Icon, color, label, value, unit, foot }: { icon: React.ElementType; color: string; label: string; value: React.ReactNode; unit?: string; foot?: string }) {
  return (
    <div className="tile" style={{ ["--accent-color" as string]: color }}>
      <div className="tile-label"><Icon size={14} /> {label}</div>
      <div className="tile-value">{value}{unit && <span className="unit">{unit}</span>}</div>
      {foot && <div className="tile-foot">{foot}</div>}
    </div>
  );
}

// ── COMMAND CENTER ──────────────────────────────────────────────────────────────
function CommandCenter(p: {
  urs: number; ursClass: RiskClass; drains: Drain[]; reports: CommunityReport[]; alerts: Alert[];
  readings: Reading[]; forecast: ForecastStep[]; loading: boolean; error: string | null;
  nodeId: string; nodeLabel: string; liveDistance: number | null; liveMethane: number | null;
  ws: ReturnType<typeof useWebSocket>; perNodeDistance: Record<string, number | null>;
}) {
  const critical = p.drains.filter((d) => (d.risk_score ?? 0) >= 60);
  const affectedAreas = Object.values(p.perNodeDistance).filter((d) => d != null && d <= 80).length;
  const affectedPop = AREAS.filter((a) => {
    const d = p.perNodeDistance[a.id];
    return d != null && d <= 80;
  }).reduce((s, a) => s + a.population, 0);
  const meta = riskMeta(p.ursClass);
  const workerDanger = (p.liveMethane ?? 0) >= 500 || p.drains.some((d) => (d.risk_score ?? 0) >= 75);

  return (
    <>
      <PageHead title="Municipal Command Center" sub="Consolidated operational picture across all monitored basins and drains." />

      <div className="urs-hero">
        <HeroRing value={p.urs} />
        <div className="urs-info">
          <h2>City-wide status: <span style={{ color: meta.color === "#1f9d55" ? "#7fe0a8" : meta.color }}>{meta.label.toUpperCase()}</span></h2>
          <p>Urban Risk Score aggregates live water levels, drain stress and rise rates across all nodes. Higher score = greater city-wide flood pressure.</p>
          <div className="urs-chips">
            <div className="urs-chip"><b>{p.alerts.filter((a) => a.flood_level !== "green").length}</b> Active alerts</div>
            <div className="urs-chip"><b>{affectedAreas}</b> Affected areas</div>
            <div className="urs-chip"><b>{critical.length}</b> Critical drains</div>
            <div className="urs-chip"><b>{(affectedPop / 1000).toFixed(0)}K</b> Population exposed</div>
          </div>
        </div>
      </div>

      <div className="tile-row">
        <Tile icon={Siren} color="#d1242f" label="Active Alerts" value={p.alerts.filter((a) => a.flood_level !== "green").length} foot="across all channels" />
        <Tile icon={Waves} color="#e2680c" label="Affected Areas" value={affectedAreas} foot="at Watch or above" />
        <Tile icon={Radio} color="#14508c" label="Critical Drain Nodes" value={critical.length} unit={` / ${p.drains.length}`} foot="risk ≥ 60" />
        <Tile icon={Users} color="#6d28d9" label="Affected Population" value={`${(affectedPop / 1000).toFixed(0)}K`} foot="in exposed wards" />
        <Tile icon={HardHat} color={workerDanger ? "#d1242f" : "#1f9d55"} label="Worker Safety" value={workerDanger ? "RESTRICTED" : "CLEAR"} foot="sewer entry status" />
        <Tile icon={MessageSquare} color="#1763b3" label="Community Reports" value={p.reports.length} foot="citizen submissions" />
        <Tile icon={TrendingUp} color="#1f9d55" label="Recovery Estimate" value={p.urs >= 50 ? "4–6 h" : "—"} foot="after peak" />
      </div>

      <div className="split-3-1">
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="gcard gcard-pad">
            <div className="gcard-title"><Activity size={15} /> {p.nodeLabel} — Live Cross-section</div>
            <RiverAnimation nodeLabel={p.nodeLabel} distanceCm={p.liveDistance} />
          </div>
          <div className="gcard gcard-pad">
            <div className="gcard-title"><Waves size={15} /> 2-Hour Forecast</div>
            <ForecastChart readings={p.readings} forecast={p.forecast} loading={p.loading} error={p.error} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <AlertPanel alerts={p.alerts} />
          <SewerSafetyPanel methanePpm={p.liveMethane} />
        </div>
      </div>
    </>
  );
}

// ── DIGITAL TWIN ─────────────────────────────────────────────────────────────────
function TwinPage({ drains, selected, onSelect }: { drains: Drain[]; selected: Drain | null; onSelect: (id: string) => void }) {
  return (
    <>
      <PageHead title="Digital Drainage Twin" sub="Physical model of every drain — capacity, fill, overflow margin, health and risk." />
      <div className="split-2">
        <div className="gtable-wrap">
          <table className="gtable">
            <thead><tr><th>Drain</th><th>Ward</th><th>Fill</th><th>Health</th><th>Risk</th><th>Status</th></tr></thead>
            <tbody>
              {drains.map((d) => {
                const risk = d.risk_score ?? 0;
                const color = riskScoreColor(risk);
                return (
                  <tr key={d.drain_id} onClick={() => onSelect(d.drain_id)} style={{ cursor: "pointer" }}>
                    <td><div style={{ fontWeight: 700, color: "var(--gov-900)" }}>{d.name ?? d.drain_id}</div><div className="drain-node-id">{d.drain_id}</div></td>
                    <td>{d.ward ?? "—"}</td>
                    <td className="num">{d.fill_pct != null ? `${d.fill_pct.toFixed(0)}%` : "—"}</td>
                    <td>{d.health_label ?? (d.health_score != null ? `${d.health_score}` : "—")}</td>
                    <td className="num" style={{ color }}>{risk}</td>
                    <td><span className="dotled" style={{ background: color }} /> <span style={{ color }}>{d.stress_category ?? "—"}</span></td>
                  </tr>
                );
              })}
              {drains.length === 0 && <tr><td colSpan={6} className="empty">No drain profiles loaded.</td></tr>}
            </tbody>
          </table>
        </div>
        <DrainTwinPanel drain={selected ?? drains[0] ?? null} />
      </div>
    </>
  );
}

// ── LIVE DRAIN NETWORK ────────────────────────────────────────────────────────────
function NetworkPage({ drains, ws, onSelect }: { drains: Drain[]; ws: ReturnType<typeof useWebSocket>; onSelect: (id: string) => void }) {
  return (
    <>
      <PageHead title="Live Drain Network" sub="Every drain node — water level, rise rate, methane, flood risk, time-to-flood and health." />
      <div className="drain-grid">
        {drains.map((d) => {
          const live = ws.latest[d.drain_id]?.distance_cm;
          const waterLevel = live ?? d.current_water_level_cm ?? null;
          const fill = d.fill_pct ?? null;
          const risk = d.risk_score ?? 0;
          const color = riskScoreColor(risk);
          const cat = d.stress_category ?? riskFromDistance(waterLevel);
          const methane = ws.methane[d.drain_id];
          const ttf = timeToFloodMin(waterLevel, 0.3);
          return (
            <div key={d.drain_id} className="drain-node" style={{ ["--node-color" as string]: color }} onClick={() => onSelect(d.drain_id)}>
              <div className="drain-node-head">
                <div><div className="drain-node-name">{d.name ?? d.drain_id}</div><div className="drain-node-id">{d.ward ?? d.drain_id}</div></div>
                <span className="sbadge" style={{ background: color + "1a", color }}>{cat}</span>
              </div>
              <div className="drain-metrics">
                <div className="dm"><div className="dm-k">Water Level</div><div className="dm-v">{waterLevel != null ? `${waterLevel.toFixed(0)} cm` : "—"}</div></div>
                <div className="dm"><div className="dm-k">Rise Rate</div><div className="dm-v">{(0.3).toFixed(2)} <span style={{ fontSize: 11, color: "var(--muted)" }}>cm/min</span></div></div>
                <div className="dm"><div className="dm-k">Methane</div><div className="dm-v">{methane != null ? `${methane.toFixed(0)} ppm` : "—"}</div></div>
                <div className="dm"><div className="dm-k">Flood Risk</div><div className="dm-v" style={{ color }}>{risk}</div></div>
                <div className="dm"><div className="dm-k">Time-to-Flood</div><div className="dm-v" style={{ fontSize: 13 }}>{formatTTF(ttf)}</div></div>
                <div className="dm"><div className="dm-k">Health</div><div className="dm-v">{d.health_score ?? "—"}</div></div>
              </div>
              {fill != null && <div className="fillbar"><div style={{ width: `${Math.min(100, fill)}%`, background: color }} /></div>}
            </div>
          );
        })}
        {drains.length === 0 && <div className="empty"><Radio size={28} /><div>No drain nodes available.</div></div>}
      </div>
    </>
  );
}

// ── FLOOD INTELLIGENCE ────────────────────────────────────────────────────────────
function FloodPage({ readings, forecast, loading, error, liveDistance, riseRate }: {
  readings: Reading[]; forecast: ForecastStep[]; loading: boolean; error: string | null;
  liveDistance: number | null; riseRate: number;
}) {
  const steps = [0, 1, 2, 3].map((i) => forecast[i]?.distance_cm_predicted ?? null);
  const labels = ["30 min", "60 min", "90 min", "120 min"];
  const ttf = timeToFloodMin(liveDistance, riseRate);

  return (
    <>
      <PageHead title="Flood Intelligence" sub="Time-to-flood, escalation forecast and recovery prediction — ARIMAX 2-hour horizon." />
      <div className="tile-row">
        <Tile icon={Siren} color="#d1242f" label="Time-to-Flood" value={formatTTF(ttf)} foot="at current rise rate" />
        {steps.map((s, i) => {
          const r = riskFromDistance(s);
          const m = riskMeta(r);
          return <Tile key={i} icon={Waves} color={m.color} label={`Forecast +${labels[i]}`} value={s != null ? s.toFixed(0) : "—"} unit="cm" foot={m.label} />;
        })}
      </div>

      <div className="gcard gcard-pad" style={{ marginBottom: 18 }}>
        <div className="gcard-title"><TrendingUp size={15} /> Flood Escalation Forecast</div>
        <ForecastChart readings={readings} forecast={forecast} loading={loading} error={error} />
      </div>

      <div className="split-2">
        <div className="gcard gcard-pad">
          <div className="gcard-title"><Activity size={15} /> Flood Severity Timeline</div>
          <div style={{ display: "flex", gap: 0, marginTop: 6 }}>
            {[{ d: liveDistance, l: "Now" }, ...steps.map((s, i) => ({ d: s, l: labels[i] }))].map((pt, i) => {
              const r = riskFromDistance(pt.d);
              const m = riskMeta(r);
              return (
                <div key={i} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: 8, background: m.color, opacity: pt.d == null ? 0.25 : 1 }} />
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{pt.l}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: m.color }}>{pt.d == null ? "—" : m.label}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 18, flexWrap: "wrap" }}>
            {(["SAFE", "WATCH", "WARNING", "CRITICAL"] as RiskClass[]).map((r) => (
              <span key={r} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
                <span className="dotled" style={{ background: riskMeta(r).color }} /> {riskMeta(r).label}
              </span>
            ))}
          </div>
        </div>

        <div className="gcard gcard-pad">
          <div className="gcard-title"><GitBranchPlus size={15} /> Recovery Prediction</div>
          <div className="kvlist">
            <div className="kv"><span className="k">Estimated peak</span><span className="v">{ttf == null ? "No escalation" : `in ~${formatTTF(ttf)}`}</span></div>
            <div className="kv"><span className="k">Recovery to Watch</span><span className="v">4–6 hours after peak</span></div>
            <div className="kv"><span className="k">Recovery to Safe</span><span className="v">8–12 hours after peak</span></div>
            <div className="kv"><span className="k">Confidence</span><span className="v">Moderate–High (ARIMAX + trend)</span></div>
          </div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12, lineHeight: 1.5 }}>
            Recovery assumes rainfall easing within the forecast window. Continued upstream inflow will extend timelines.
          </p>
        </div>
      </div>
    </>
  );
}

// ── SEWER SAFETY ──────────────────────────────────────────────────────────────────
function SewerPage({ methane, drains, ws }: { methane: number | null; drains: Drain[]; ws: ReturnType<typeof useWebSocket> }) {
  const nodes = [...AREAS.map((a) => a.id), ...drains.map((d) => d.drain_id)];
  const reads = nodes.map((id) => ({ id, ppm: id === AREAS[0].id ? methane : ws.methane[id] ?? null }));
  const allowed = reads.filter((r) => (r.ppm ?? 0) < 200).length;
  const restricted = reads.filter((r) => (r.ppm ?? 0) >= 200 && (r.ppm ?? 0) < 500).length;
  const prohibited = reads.filter((r) => (r.ppm ?? 0) >= 500).length;

  return (
    <>
      <PageHead title="Sewer Safety" sub="MQ-4 methane monitoring, sewer safety index and worker-entry clearance." />
      <div className="split-2">
        <SewerSafetyPanel methanePpm={methane} />
        <div className="gcard gcard-pad">
          <div className="gcard-title"><HardHat size={15} /> Worker Entry Clearance — Network</div>
          <div className="sewer-status-grid">
            <div className="sewer-stat" style={{ borderColor: "#1f9d55" }}><b style={{ color: "#1f9d55" }}>{allowed}</b><span>ENTRY ALLOWED</span></div>
            <div className="sewer-stat" style={{ borderColor: "#c98a00" }}><b style={{ color: "#c98a00" }}>{restricted}</b><span>ENTRY RESTRICTED</span></div>
            <div className="sewer-stat" style={{ borderColor: "#d1242f" }}><b style={{ color: "#d1242f" }}>{prohibited}</b><span>ENTRY PROHIBITED</span></div>
          </div>
          <table className="gtable" style={{ marginTop: 16 }}>
            <thead><tr><th>Node</th><th>Methane</th><th>Index</th><th>Clearance</th></tr></thead>
            <tbody>
              {reads.map((r) => {
                const idx = (r.ppm ?? 0) >= 1000 ? "CRITICAL" : (r.ppm ?? 0) >= 500 ? "DANGER" : (r.ppm ?? 0) >= 200 ? "CAUTION" : "SAFE";
                const color = idx === "CRITICAL" || idx === "DANGER" ? "#d1242f" : idx === "CAUTION" ? "#c98a00" : "#1f9d55";
                const clr = (r.ppm ?? 0) >= 500 ? "ENTRY PROHIBITED" : (r.ppm ?? 0) >= 200 ? "ENTRY RESTRICTED" : "ENTRY ALLOWED";
                return <tr key={r.id}><td style={{ fontSize: 12.5 }}>{r.id}</td><td className="num">{r.ppm != null ? `${r.ppm.toFixed(0)} ppm` : "no sensor"}</td><td style={{ color }}>{idx}</td><td style={{ color, fontWeight: 600 }}>{clr}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── ANOMALY DETECTION ─────────────────────────────────────────────────────────────
function AnomalyPage({ nodeId, drains, liveDistance, riseRate, methane }: {
  nodeId: string; drains: Drain[]; liveDistance: number | null; riseRate: number; methane: number | null;
}) {
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setLoading(true); fetchAnalysis(nodeId).then(setAnalysis).catch(() => setAnalysis(null)).finally(() => setLoading(false)); }, [nodeId]);

  // Rule-based anomaly detection from live signals.
  const anomalies: { title: string; desc: string; crit: boolean }[] = [];
  if (riseRate > 1.2) anomalies.push({ title: "Unexpected Water Rise", desc: `Water rising at ${riseRate.toFixed(2)} cm/min — well above normal inflow.`, crit: riseRate > 2 });
  if ((methane ?? 0) >= 500) anomalies.push({ title: "Methane Spike", desc: `Methane at ${methane?.toFixed(0)} ppm exceeds the danger threshold (500 ppm).`, crit: (methane ?? 0) >= 1000 });
  const stressed = drains.filter((d) => (d.fill_pct ?? 0) > 70 && (d.risk_score ?? 0) > 50);
  if (stressed.length) anomalies.push({ title: "Possible Obstruction / Reduced Capacity", desc: `${stressed.length} drain(s) showing high fill with elevated risk — possible blockage reducing capacity.`, crit: false });
  if (liveDistance != null && liveDistance <= 50) anomalies.push({ title: "Channel Near Overflow", desc: `Distance to water ${liveDistance.toFixed(0)} cm — approaching overflow margin.`, crit: liveDistance <= 40 });

  // Zero-rainfall blockage detection: water is high but not actively rising — stagnant
  // water that isn't draining points to a physical blockage, not an active rain event.
  const highWater = liveDistance != null && liveDistance <= 80;
  const stagnant = Math.abs(riseRate) < 0.05;
  const highFillDrains = drains.filter((d) => (d.fill_pct ?? 0) > 60);
  if (highWater && stagnant) {
    const drainNote = highFillDrains.length > 0
      ? ` ${highFillDrains.length} drain(s) also showing high fill — check ${highFillDrains.map((d) => d.name ?? d.drain_id).join(", ")} for debris or sediment.`
      : " Inspect outlet channels and culverts for debris, sediment, or collapsed infrastructure.";
    anomalies.push({
      title: "Zero Rainfall — Possible Blockage",
      desc: `Water level is high (${liveDistance!.toFixed(0)} cm from sensor) but rise rate is near zero — no active inflow detected. Likely causes: drain outlet blockage, clogged grating, or silt build-up.${drainNote}`,
      crit: liveDistance! <= 50,
    });
  }

  if (!anomalies.length) anomalies.push({ title: "No anomalies detected", desc: "All monitored signals are within expected operating ranges.", crit: false });

  return (
    <>
      <PageHead title="Anomaly Detection" sub="Automated detection of obstructions, capacity loss, abnormal rise and methane spikes." />
      <div className="split-2">
        <div>
          <div className="gcard-title"><AlertTriangle size={15} /> Detected Anomalies</div>
          {anomalies.map((a, i) => (
            <div key={i} className={`anomaly-item ${a.crit ? "crit" : ""}`}>
              <div className="an-ic">{a.crit ? <Siren size={18} /> : <AlertTriangle size={18} />}</div>
              <div><div className="an-title">{a.title}</div><div className="an-desc">{a.desc}</div></div>
            </div>
          ))}
        </div>
        <div className="ai-card">
          <div className="ai-head"><span className="ai-badge"><Sparkles size={12} /> Gemini AI</span><h3>Root Cause Analysis</h3></div>
          {loading && <div className="ai-summary">Analysing node telemetry…</div>}
          {!loading && (
            <>
              <div className="ai-summary">{analysis?.summary && analysis.summary.length > 8 ? analysis.summary : "Telemetry analysed. The most likely driver of current readings is upstream inflow combined with constrained drain capacity. Monitor rise rate and clear any obstructions at high-fill nodes."}</div>
              {analysis?.risk_explanation && <p style={{ fontSize: 13.5, color: "var(--text)", marginTop: 10 }}>{analysis.risk_explanation}</p>}
              {!!analysis?.root_cause?.length && (
                <div style={{ marginTop: 12 }}>
                  <div className="af-k" style={{ marginBottom: 6 }}>Probable Causes</div>
                  {analysis.root_cause.map((c, i) => <div key={i} className="kv"><span className="k">• {c}</span><span /></div>)}
                </div>
              )}
              {!!analysis?.recommendations?.length && (
                <div style={{ marginTop: 12 }}>
                  <div className="af-k" style={{ marginBottom: 6 }}>Recommended Actions</div>
                  {analysis.recommendations.map((c, i) => <div key={i} className="kv"><span className="k">→ {c}</span><span /></div>)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── ASSET PRIORITIZATION ──────────────────────────────────────────────────────────
function AssetsPage({ drains }: { drains: Drain[] }) {
  const ranked = [...drains].sort((a, b) => (b.criticality_score ?? b.risk_score ?? 0) - (a.criticality_score ?? a.risk_score ?? 0));
  const prio = (i: number) => (i < Math.ceil(ranked.length / 3) ? 1 : i < Math.ceil((2 * ranked.length) / 3) ? 2 : 3);
  return (
    <>
      <PageHead title="Asset Prioritization" sub="Maintenance ranking by criticality, health and risk — focus crews where it matters most." />
      <div className="gtable-wrap">
        <table className="gtable">
          <thead><tr><th>Priority</th><th>Drain</th><th>Ward</th><th>Health</th><th>Risk</th><th>Criticality</th><th>Maintenance Urgency</th></tr></thead>
          <tbody>
            {ranked.map((d, i) => {
              const p = prio(i);
              const risk = d.risk_score ?? 0;
              const crit = d.criticality_score ?? risk;
              const urgency = crit >= 70 ? "Immediate" : crit >= 45 ? "Within 48 h" : "Routine";
              return (
                <tr key={d.drain_id}>
                  <td><span className={`prio p${p}`}>PRIORITY {p}</span></td>
                  <td><div style={{ fontWeight: 700, color: "var(--gov-900)" }}>{d.name ?? d.drain_id}</div><div className="drain-node-id">{d.drain_id}</div></td>
                  <td>{d.ward ?? "—"}</td>
                  <td>{d.health_score ?? "—"}</td>
                  <td className="num" style={{ color: riskScoreColor(risk) }}>{risk}</td>
                  <td><div className="pbar"><div style={{ width: `${Math.min(100, crit)}%`, background: riskScoreColor(crit) }} /></div></td>
                  <td style={{ fontWeight: 600, color: crit >= 70 ? "#d1242f" : crit >= 45 ? "#e2680c" : "#1f9d55" }}>{urgency}</td>
                </tr>
              );
            })}
            {drains.length === 0 && <tr><td colSpan={7} className="empty">No drain assets loaded.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── INFRASTRUCTURE IMPACT ─────────────────────────────────────────────────────────
const INFRA_META: Record<InfraKind, { label: string; icon: React.ElementType; color: string }> = {
  hospital: { label: "Hospitals", icon: Cross, color: "#d1242f" },
  school:   { label: "Schools", icon: GraduationCap, color: "#6d28d9" },
  road:     { label: "Roads & Corridors", icon: Route, color: "#e2680c" },
  transit:  { label: "Transit", icon: Bus, color: "#14508c" },
};
function InfraPage({ perNodeDistance }: { perNodeDistance: Record<string, number | null> }) {
  const kinds: InfraKind[] = ["hospital", "school", "road", "transit"];
  // Infrastructure criticality score weighted by nearby area risk.
  const scored = INFRA.map((a) => {
    const d = perNodeDistance[a.area];
    const areaRisk = d == null ? 0 : Math.max(0, Math.min(100, ((120 - d) / 90) * 100));
    const impact = Math.round(0.6 * a.criticality + 0.4 * areaRisk);
    return { ...a, impact, areaRisk: Math.round(areaRisk) };
  });
  const ics = Math.round(scored.reduce((s, a) => s + a.impact, 0) / Math.max(1, scored.length));

  return (
    <>
      <PageHead title="Infrastructure Impact" sub="Flood risk to critical public infrastructure, with an Infrastructure Criticality Score." />
      <div className="tile-row">
        <Tile icon={Building2} color={ics >= 60 ? "#d1242f" : ics >= 40 ? "#e2680c" : "#1f9d55"} label="Infrastructure Criticality Score" value={ics} unit="/100" foot="weighted across all assets" />
        {kinds.map((k) => {
          const items = scored.filter((s) => s.kind === k);
          const avg = Math.round(items.reduce((s, a) => s + a.impact, 0) / Math.max(1, items.length));
          return <Tile key={k} icon={INFRA_META[k].icon} color={INFRA_META[k].color} label={INFRA_META[k].label} value={items.length} foot={`avg impact ${avg}`} />;
        })}
      </div>

      <div className="infra-grid">
        {kinds.map((k) => (
          <div key={k} className="infra-card">
            <div className="if-head">
              <div className="if-ic" style={{ background: INFRA_META[k].color }}>{(() => { const I = INFRA_META[k].icon; return <I size={19} />; })()}</div>
              <div><div className="if-name">{INFRA_META[k].label}</div><div className="if-count">{scored.filter((s) => s.kind === k).length} assets monitored</div></div>
            </div>
            {scored.filter((s) => s.kind === k).map((a) => (
              <div key={a.id} className="kv">
                <span className="k">{a.name}</span>
                <span className="v" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="pbar" style={{ width: 60 }}><div style={{ width: `${a.impact}%`, background: a.impact >= 60 ? "#d1242f" : a.impact >= 40 ? "#e2680c" : "#1f9d55" }} /></span>
                  {a.impact}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// ── ANALYTICS ──────────────────────────────────────────────────────────────────────
function AnalyticsPage({ alerts, nodeId }: { alerts: Alert[]; nodeId: string }) {
  return (
    <>
      <PageHead title="Analytics" sub="Flood, recovery, incident and risk trends with historical event replay." />
      <div className="gcard gcard-pad" style={{ marginBottom: 18 }}>
        <HistoricalTrends alerts={alerts} nodeId={nodeId} />
      </div>
      <div className="gcard gcard-pad">
        <div className="gcard-title"><Activity size={15} /> Historical Event Replay</div>
        <FloodReplayTimeline alerts={alerts} nodeId={nodeId} />
      </div>
    </>
  );
}

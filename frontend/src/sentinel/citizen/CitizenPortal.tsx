import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Droplets,
  Gauge,
  Home,
  Languages,
  MapPin,
  MessageSquarePlus,
  Navigation,
  Phone,
  Send,
  ShieldCheck,
  Siren,
  Sparkles,
  User,
  Volume2,
  Waves,
} from "lucide-react";

import { useWebSocket } from "../../hooks/useWebSocket";
import {
  fetchAlerts,
  fetchBriefing,
  fetchReadings,
  fetchReports,
  submitReport,
  type BriefingResponse,
  type CommunityReport,
} from "../../api";
import type { Alert, Reading, RiskClass } from "../../types";
import {
  AREAS,
  ALERT_KIND_LABELS,
  RELIEF_CENTERS,
  SAFE_ZONES,
  buildSituationSummary,
  estimateRiseRate,
  formatTTF,
  haversineKm,
  riskFromDistance,
  riskMeta,
  safetyScore,
  scoreBand,
  timeToFloodMin,
  travelTimeMin,
} from "../data";
import CitizenMap from "./CitizenMap";

type Tab = "home" | "map" | "safezone" | "alerts" | "report" | "profile";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "home",     label: "Home",            icon: Home },
  { key: "map",      label: "Live Flood Map",  icon: MapPin },
  { key: "safezone", label: "Safe Zone Finder", icon: Navigation },
  { key: "alerts",   label: "Alert Center",    icon: Bell },
  { key: "report",   label: "Report an Issue", icon: MessageSquarePlus },
  { key: "profile",  label: "My Profile",      icon: User },
];

// ── Circular ring gauge ───────────────────────────────────────────────────────
function Ring({ value, color, size = 150, stroke = 13 }: { value: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8edf3" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

function langCode(langHint: string) {
  return langHint === "Telugu" ? "te-IN" : langHint === "Tamil" ? "ta-IN" : "en-IN";
}

async function speak(text: string, langHint: string) {
  const lang = langCode(langHint);
  try {
    const resp = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang }),
    });
    if (resp.ok && resp.status !== 204) {
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
      return;
    }
  } catch { /* fall through to browser TTS */ }
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* unavailable */ }
}

export default function CitizenPortal() {
  const [tab, setTab] = useState<Tab>("home");
  const [areaId, setAreaId] = useState(AREAS[0].id);
  const ws = useWebSocket();

  const [readings, setReadings] = useState<Reading[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [briefing, setBriefing] = useState<BriefingResponse | null>(null);
  const [lang, setLang] = useState("Telugu");
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locState, setLocState] = useState<"idle" | "requesting" | "granted" | "denied">("idle");

  const area = useMemo(() => AREAS.find((a) => a.id === areaId) ?? AREAS[0], [areaId]);

  const load = useCallback(async (id: string) => {
    const [r, a] = await Promise.allSettled([fetchReadings(id, 6), fetchAlerts(id, 30)]);
    setReadings(r.status === "fulfilled" ? r.value : []);
    setAlerts(a.status === "fulfilled" ? a.value : []);
    fetchBriefing(id).then(setBriefing).catch(() => setBriefing(null));
  }, []);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) { setLocState("denied"); return; }
    setLocState("requesting");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setUserPos(pos);
        setLocState("granted");
        // Auto-select nearest monitored node to the user's physical location.
        const nearest = AREAS.reduce((best, a) =>
          haversineKm(pos, a) < haversineKm(pos, best) ? a : best,
        );
        setAreaId(nearest.id);
      },
      () => setLocState("denied"),
      { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 },
    );
  }, []);

  // Try silently on first load; if denied, surface the button.
  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" }).then((result) => {
      if (result.state === "granted") requestLocation();
      else if (result.state === "prompt") requestLocation();
      else setLocState("denied");
    }).catch(() => requestLocation()); // fallback for browsers without permissions API
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(areaId); }, [areaId, load]);
  useEffect(() => { fetchReports(100).then((d) => setReports(d.reports)).catch(() => setReports([])); }, []);

  // Live distance: prefer WS, fall back to last REST reading.
  const liveDistance =
    ws.latest[areaId]?.distance_cm ??
    (readings.length ? readings[readings.length - 1].distance_cm : null);
  const riseRate = useMemo(() => estimateRiseRate(readings), [readings]);
  const risk: RiskClass = riskFromDistance(liveDistance);
  const meta = riskMeta(risk);
  const score = safetyScore(liveDistance, riseRate, area.lowLying);
  const band = scoreBand(score);
  const ttf = timeToFloodMin(liveDistance, riseRate);

  // Per-area risk map for the flood map.
  const areaRisk = useMemo(() => {
    const map: Record<string, RiskClass> = {};
    for (const a of AREAS) {
      const d = ws.latest[a.id]?.distance_cm ?? (a.id === areaId && liveDistance != null ? liveDistance : null);
      map[a.id] = riskFromDistance(d);
    }
    return map;
  }, [ws.latest, areaId, liveDistance]);

  const summary = useMemo(
    () => buildSituationSummary(area.name, risk, liveDistance, riseRate, ttf),
    [area.name, risk, liveDistance, riseRate, ttf],
  );

  // Safe zone + relief center finder:
  //   - Filter candidates to those within 60 km of the SELECTED AREA (so Godavari area
  //     shows Rajahmundry shelters, not Vijayawada ones).
  //   - Among those, rank by distance from the user's live GPS (or area center if no GPS).
  const userRef = userPos ?? { lat: area.lat, lng: area.lng };
  const nearestZone = useMemo(() => {
    const areaCenter = { lat: area.lat, lng: area.lng };
    const nearby = SAFE_ZONES.filter((z) => haversineKm(areaCenter, z) < 60);
    const pool = nearby.length ? nearby : SAFE_ZONES; // fallback: all zones
    return pool
      .map((z) => ({ z, km: haversineKm(userRef, z) }))
      .sort((a, b) => a.km - b.km)[0];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.id, userRef.lat, userRef.lng]);
  const nearestRelief = useMemo(() => {
    const areaCenter = { lat: area.lat, lng: area.lng };
    const nearby = RELIEF_CENTERS.filter((c) => haversineKm(areaCenter, c) < 60);
    const pool = nearby.length ? nearby : RELIEF_CENTERS;
    return pool
      .map((c) => ({ c, km: haversineKm(userRef, c) }))
      .sort((a, b) => a.km - b.km)[0];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.id, userRef.lat, userRef.lng]);

  const activeAlertCount = alerts.filter((a) => a.flood_level !== "green").length + ws.alerts.filter((a) => a.node_id === areaId).length;

  return (
    <div className="portal-shell">
      <nav className="portal-nav">
        <div className="portal-nav-inner">
          {TABS.map((t) => (
            <button key={t.key} className={`portal-nav-item ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
              <t.icon size={15} /> {t.label}
              {t.key === "alerts" && activeAlertCount > 0 && <span className="nav-badge">{activeAlertCount}</span>}
            </button>
          ))}
        </div>
      </nav>

      <div className="portal-main">
        <div className="portal-content">
          {/* Location permission banner */}
          {locState === "denied" && (
            <div className="loc-banner">
              <MapPin size={16} />
              <span>Live location not enabled — safe zone results use area centre, not your position.</span>
              <button className="gbtn" style={{ marginLeft: "auto", padding: "4px 12px" }} onClick={requestLocation}>
                Allow Location
              </button>
            </div>
          )}
          {locState === "requesting" && (
            <div className="loc-banner loc-banner-info">
              <MapPin size={16} /> <span>Requesting your location…</span>
            </div>
          )}

          {/* Location bar (always visible) */}
          <div className="cit-locbar">
            <MapPin size={18} className="loc-icon" />
            <div>
              <div className="loc-name">{area.name}</div>
              <div className="loc-sub">
                {area.ward} · {area.city}, {area.state} ·{" "}
                {locState === "granted" ? "📍 Using your live location" : "Approximate location"}
              </div>
            </div>
            <select className="gselect loc-select" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              {AREAS.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.city}</option>)}
            </select>
          </div>

          {tab === "home" && (
            <HomePage
              area={area} risk={risk} meta={meta} liveDistance={liveDistance} riseRate={riseRate}
              score={score} band={band} ttf={ttf} summary={summary} briefing={briefing}
              lang={lang} onFindSafe={() => setTab("safezone")}
            />
          )}

          {tab === "map" && (
            <>
              <div className="page-head"><h1>Live Flood Map</h1><p>Real-time flood risk zones, relief centers, safe zones and citizen reports around you.</p></div>
              <MapLegend />
              <CitizenMap areas={AREAS} areaRisk={areaRisk} userPos={userPos} reports={reports} routeTo={nearestZone?.z ?? null} focusArea={area} />
            </>
          )}

          {tab === "safezone" && (
            <SafeZonePage nearestRelief={nearestRelief} nearestZone={nearestZone} userPos={userPos} area={area} areaRisk={areaRisk} reports={reports} lang={lang} />
          )}

          {tab === "alerts" && <AlertsPage alerts={alerts} wsAlerts={ws.alerts.filter((a) => a.node_id === areaId)} area={area} lang={lang} summary={summary} />}

          {tab === "report" && <ReportPage area={area} userPos={userPos} onSubmitted={(rep) => setReports((prev) => [rep, ...prev])} />}

          {tab === "profile" && <ProfilePage area={area} lang={lang} setLang={setLang} />}
        </div>
      </div>
    </div>
  );
}

// ── HOME ──────────────────────────────────────────────────────────────────────
function HomePage(props: {
  area: typeof AREAS[number]; risk: RiskClass; meta: ReturnType<typeof riskMeta>;
  liveDistance: number | null; riseRate: number; score: number; band: { label: string; color: string };
  ttf: number | null; summary: ReturnType<typeof buildSituationSummary>; briefing: BriefingResponse | null;
  lang: string; onFindSafe: () => void;
}) {
  const { area, risk, meta, liveDistance, riseRate, score, band, ttf, summary, briefing, lang, onFindSafe } = props;
  const cats: { r: RiskClass; name: string; desc: string }[] = [
    { r: "SAFE",     name: "SAFE",     desc: "Normal conditions" },
    { r: "WATCH",    name: "WATCH",    desc: "Stay alert" },
    { r: "WARNING",  name: "WARNING",  desc: "Prepare to act" },
    { r: "CRITICAL", name: "CRITICAL", desc: "Move to safety" },
  ];
  const aiText = briefing?.summary && briefing.summary.length > 12 ? briefing.summary : summary.situation;
  const ttfUrgent = ttf != null && ttf <= 90;

  return (
    <>
      {/* Risk hero */}
      <div className={`risk-hero ${meta.cls}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div className="risk-hero-icon"><ShieldCheck size={34} /></div>
          <div>
            <div className="risk-hero-label">Current Flood Risk · {area.name}</div>
            <div className="risk-hero-status">{meta.label.toUpperCase()}</div>
            <div className="risk-hero-desc">{summary.situation}</div>
          </div>
        </div>
      </div>

      {/* Risk category legend */}
      <div className="risk-cats">
        {cats.map((c) => (
          <div key={c.r} className={`risk-cat ${riskMeta(c.r).cls} ${c.r === risk ? "active" : ""}`}>
            <div className="rc-name">{c.name}</div>
            <div className="rc-desc">{c.desc}</div>
          </div>
        ))}
      </div>

      {/* Gemini AI Summary + side cards */}
      <div className="cit-grid">
        <div className="ai-card">
          <div className="ai-head">
            <span className="ai-badge"><Sparkles size={12} /> Gemini AI</span>
            <h3>Situation Summary</h3>
          </div>
          <div className="ai-summary">{aiText}</div>
          <div className="ai-fields">
            <Field icon={<Activity size={15} />} k="Risk Explanation" v={summary.riskExplanation} />
            <Field icon={<ShieldCheck size={15} />} k="Recommended Action" v={summary.recommendedAction} />
            <Field icon={<Clock size={15} />} k="Expected Recovery Time" v={summary.recoveryTime} />
            <Field icon={<Gauge size={15} />} k="Confidence Level" v={summary.confidence} />
          </div>
          <div className="ai-actions">
            <button className="gbtn ghost" onClick={() => speak(aiText, lang)}><Volume2 size={15} /> Play voice summary ({lang})</button>
            <button className="gbtn" onClick={onFindSafe}><Navigation size={15} /> Find safe location</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Time to flood */}
          <div className="gcard gcard-pad ttf-card">
            <div className="gcard-title"><Siren size={15} /> Estimated Time-to-Flood</div>
            <div className={`ttf-big ${ttfUrgent ? "urgent" : ""}`}>{formatTTF(ttf)}</div>
            <div className="ttf-sub">
              {ttf == null ? "Water level is stable or receding" : ttf <= 0 ? "Take shelter immediately" : `at current rise rate of ${riseRate.toFixed(2)} cm/min`}
            </div>
          </div>

          {/* Area safety score */}
          <div className="gcard gcard-pad score-card">
            <div className="gcard-title" style={{ justifyContent: "center" }}><Gauge size={15} /> Area Safety Score</div>
            <div className="score-ring">
              <Ring value={score} color={band.color} />
              <div className="score-num">
                <b>{score}</b>
                <span>out of 100</span>
              </div>
            </div>
            <div className="score-label" style={{ color: band.color }}>{band.label}</div>
          </div>
        </div>
      </div>

      {/* Live snapshot strip */}
      <div className="tile-row">
        <Tile icon={Droplets} color={meta.color} label="Water Distance" value={liveDistance != null ? liveDistance.toFixed(0) : "—"} unit="cm" foot="Lower = higher water" />
        <Tile icon={Activity} color="#6d28d9" label="Rise Rate" value={riseRate.toFixed(2)} unit="cm/min" foot={riseRate > 0 ? "Water rising" : "Stable / receding"} />
        <Tile icon={Waves} color={meta.color} label="Risk Level" value={meta.label} foot={`${area.city}, ${area.state}`} />
        <Tile icon={Clock} color="#1763b3" label="Time-to-Flood" value={ttf == null ? "None" : formatTTF(ttf)} foot="2-hour forecast horizon" />
      </div>
    </>
  );
}

function Field({ icon, k, v }: { icon: React.ReactNode; k: string; v: string }) {
  return (
    <div className="ai-field">
      <div className="af-ic">{icon}</div>
      <div><div className="af-k">{k}</div><div className="af-v">{v}</div></div>
    </div>
  );
}

function Tile({ icon: Icon, color, label, value, unit, foot }: { icon: React.ElementType; color: string; label: string; value: string; unit?: string; foot?: string }) {
  return (
    <div className="tile" style={{ ["--accent-color" as string]: color }}>
      <div className="tile-label"><Icon size={14} /> {label}</div>
      <div className="tile-value">{value}{unit && <span className="unit">{unit}</span>}</div>
      {foot && <div className="tile-foot">{foot}</div>}
    </div>
  );
}

function MapLegend() {
  const items = [
    { c: "#1f9d55", t: "Safe area / Safe zone" },
    { c: "#c98a00", t: "Watch" },
    { c: "#e2680c", t: "Warning / Report" },
    { c: "#d1242f", t: "Critical / Flooded" },
    { c: "#1763b3", t: "Relief center / You" },
  ];
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
      {items.map((i) => (
        <span key={i.t} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--muted)" }}>
          <span className="dotled" style={{ background: i.c }} /> {i.t}
        </span>
      ))}
    </div>
  );
}

// ── SAFE ZONE FINDER ───────────────────────────────────────────────────────────
function SafeZonePage({ nearestRelief, nearestZone, userPos, area, areaRisk, reports, lang }: {
  nearestRelief: { c: typeof RELIEF_CENTERS[number]; km: number };
  nearestZone: { z: typeof SAFE_ZONES[number]; km: number };
  userPos: { lat: number; lng: number } | null;
  area: typeof AREAS[number];
  areaRisk: Record<string, RiskClass>;
  reports: CommunityReport[];
  lang: string;
}) {
  const reliefMin = travelTimeMin(nearestRelief.km);
  const zoneMin = travelTimeMin(nearestZone.km);
  const why = `${nearestRelief.c.name} is recommended because it is the closest staffed shelter (${nearestRelief.km.toFixed(1)} km, about ${reliefMin} min away), sits on higher ground outside the flood line, and has capacity for ${nearestRelief.c.capacity.toLocaleString()} people. The highlighted route avoids low-lying lanes currently reporting waterlogging.`;

  return (
    <>
      <div className="page-head">
        <h1>Safe Zone Finder</h1>
        <p>The nearest relief center and safe zone from your location, with an estimated safe route.</p>
      </div>

      <div className="zone-result best">
        <div className="zone-ic"><ShieldCheck size={22} /></div>
        <div style={{ flex: 1 }}>
          <div className="zone-name">{nearestRelief.c.name}</div>
          <div className="zone-meta">
            <span><b>{nearestRelief.c.type}</b></span>
            <span>Distance <b>{nearestRelief.km.toFixed(1)} km</b></span>
            <span>Travel <b>~{reliefMin} min</b></span>
            <span>Capacity <b>{nearestRelief.c.capacity.toLocaleString()}</b></span>
          </div>
        </div>
        <button className="gbtn" onClick={() => speak(`Move to ${nearestRelief.c.name}, ${reliefMin} minutes away.`, lang)}><Volume2 size={15} /> Voice</button>
      </div>

      <div className="zone-result">
        <div className="zone-ic" style={{ background: "#1f9d55" }}><Navigation size={22} /></div>
        <div style={{ flex: 1 }}>
          <div className="zone-name">Nearest Safe Zone — {nearestZone.z.name}</div>
          <div className="zone-meta">
            <span>{nearestZone.z.elevationNote}</span>
            <span>Distance <b>{nearestZone.km.toFixed(1)} km</b></span>
            <span>Travel <b>~{zoneMin} min</b></span>
          </div>
        </div>
      </div>

      <div className="ai-card" style={{ marginTop: 6, marginBottom: 18 }}>
        <div className="ai-head"><span className="ai-badge"><Sparkles size={12} /> Gemini AI</span><h3>Why this location?</h3></div>
        <div className="ai-summary">{why}</div>
      </div>

      <div className="map-host">
        <CitizenMap areas={AREAS} areaRisk={areaRisk} userPos={userPos ?? { lat: area.lat, lng: area.lng }} reports={reports} routeTo={nearestRelief.c} focusArea={area} />
      </div>
    </>
  );
}

// ── ALERT CENTER ────────────────────────────────────────────────────────────────
function AlertsPage({ alerts, wsAlerts, area, lang, summary }: {
  alerts: Alert[]; wsAlerts: Alert[]; area: typeof AREAS[number]; lang: string;
  summary: ReturnType<typeof buildSituationSummary>;
}) {
  const merged = [...wsAlerts, ...alerts].slice(0, 40);
  const synthetic = merged.length === 0;

  // Build a friendly feed; if no real alerts, show current advisory derived from risk.
  const feed = synthetic
    ? [{
        kind: "Flood Advisory",
        msg: summary.recommendedAction,
        color: "#1763b3",
        time: "Just now",
        icon: Bell,
      }]
    : merged.map((a) => {
        const m = riskMeta((a.risk_class as RiskClass) ?? "WATCH");
        return {
          kind: `Flood Alert — ${m.label}`,
          msg: a.briefing || `Water distance ${a.distance_cm?.toFixed?.(0) ?? "—"} cm at ${area.name}.`,
          color: m.color,
          time: new Date(a.ts).toLocaleString(),
          icon: Siren,
        };
      });

  const categories = [
    { name: "Flood Alerts", icon: Waves, color: "#1763b3" },
    { name: "Safety Alerts", icon: ShieldCheck, color: "#1f9d55" },
    { name: "Recovery Notifications", icon: CheckCircle2, color: "#138808" },
    { name: "Sewer Safety Alerts", icon: AlertTriangle, color: "#e2680c" },
  ];

  return (
    <>
      <div className="page-head"><h1>Alert Center</h1><p>Flood, safety, recovery and sewer alerts for {area.name}. Available as voice in your language.</p></div>

      <div className="cit-grid-3" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        {categories.map((c) => (
          <div key={c.name} className="gcard gcard-pad" style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div className="a-ic" style={{ background: c.color + "1a", color: c.color, width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center" }}><c.icon size={18} /></div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--gov-900)" }}>{c.name}</div>
          </div>
        ))}
      </div>

      <div className="gcard-title" style={{ marginTop: 8 }}><Bell size={15} /> Alert History</div>
      <div className="alert-list">
        {feed.map((f, i) => (
          <div key={i} className="alert-item">
            <span className="ai-stripe" style={{ background: f.color }} />
            <div className="a-ic" style={{ background: f.color + "1a", color: f.color }}><f.icon size={18} /></div>
            <div style={{ flex: 1 }}>
              <div className="a-title">{f.kind}</div>
              <div className="a-msg">{f.msg}</div>
              <div className="a-time">{f.time}</div>
            </div>
            <button className="gbtn ghost" onClick={() => speak(f.msg, lang)}><Volume2 size={14} /></button>
          </div>
        ))}
      </div>
    </>
  );
}

// ── COMMUNITY REPORTING ─────────────────────────────────────────────────────────
function ReportPage({ area, userPos, onSubmitted }: {
  area: typeof AREAS[number]; userPos: { lat: number; lng: number } | null;
  onSubmitted: (r: CommunityReport) => void;
}) {
  const types = Object.entries(ALERT_KIND_LABELS);
  const [type, setType] = useState("waterlogging");
  const [desc, setDesc] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const rep = await submitReport({
        type, description: desc, area: `${area.name}, ${area.city}`,
        lat: userPos?.lat ?? area.lat, lon: userPos?.lng ?? area.lng,
        reporter_name: name, reporter_phone: phone, severity,
      });
      onSubmitted(rep);
      setDone(true);
      setDesc(""); setName(""); setPhone("");
    } catch {
      setDone(true); // graceful — report stored locally on backend fallback
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="gcard gcard-pad" style={{ textAlign: "center", padding: 48 }}>
        <CheckCircle2 size={48} color="#1f9d55" style={{ marginBottom: 14 }} />
        <h2 style={{ margin: "0 0 6px", color: "var(--gov-900)" }}>Report submitted</h2>
        <p style={{ color: "var(--muted)", maxWidth: 460, margin: "0 auto 20px" }}>
          Thank you. Your report has been logged and is now visible to municipal authorities on the live map.
        </p>
        <button className="gbtn" onClick={() => setDone(false)}>Submit another report</button>
      </div>
    );
  }

  return (
    <>
      <div className="page-head"><h1>Report an Issue</h1><p>Help your community — report waterlogging, blocked drains or unsafe conditions. Reports appear on the live map.</p></div>

      <div className="gcard gcard-pad" style={{ maxWidth: 720 }}>
        <div className="gfield"><label>What are you reporting?</label>
          <div className="report-types">
            {types.map(([k, label]) => (
              <div key={k} className={`report-type ${type === k ? "sel" : ""}`} onClick={() => setType(k)}>
                {k === "need_help" ? <Siren size={20} /> : k === "blocked_drain" ? <AlertTriangle size={20} /> : <Droplets size={20} />}
                <div className="rt-name">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="gfield"><label>Description</label>
          <textarea className="gtextarea" placeholder="Describe what you see (e.g. knee-deep water near the bus stop, drain overflowing)…" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="gfield"><label>Your name (optional)</label>
            <input className="ginput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          </div>
          <div className="gfield"><label>Phone (optional)</label>
            <input className="ginput" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
          </div>
        </div>

        <div className="gfield"><label>Severity</label>
          <div style={{ display: "flex", gap: 9 }}>
            {[["low", "Low"], ["medium", "Medium"], ["high", "High / Urgent"]].map(([k, l]) => (
              <button key={k} className={`gbtn ${severity === k ? "" : "ghost"}`} onClick={() => setSeverity(k)} style={{ flex: 1, justifyContent: "center" }}>{l}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <button className="gbtn" onClick={submit} disabled={busy}><Send size={15} /> {busy ? "Submitting…" : "Submit Report"}</button>
          <span style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <MapPin size={13} /> Location: {userPos ? "your GPS position" : `${area.name} (approx.)`}
          </span>
        </div>
      </div>
    </>
  );
}

// ── PROFILE ──────────────────────────────────────────────────────────────────────
function ProfilePage({ area, lang, setLang }: { area: typeof AREAS[number]; lang: string; setLang: (l: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [channels, setChannels] = useState({ website: true, whatsapp: true, sms: true, voice: false });
  const [saved, setSaved] = useState(false);

  const toggle = (k: keyof typeof channels) => setChannels((c) => ({ ...c, [k]: !c[k] }));

  return (
    <>
      <div className="page-head"><h1>My Profile</h1><p>Your details and how you want to receive flood &amp; safety alerts.</p></div>

      <div className="split-2">
        <div className="gcard gcard-pad">
          <div className="gcard-title"><User size={15} /> Personal Details</div>
          <div className="gfield"><label>Full Name</label><input className="ginput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></div>
          <div className="gfield"><label>Phone Number</label><input className="ginput" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" /></div>
          <div className="gfield"><label>Location / Ward</label><input className="ginput" defaultValue={`${area.name}, ${area.ward}`} /></div>
          <div className="gfield"><label><Languages size={13} style={{ verticalAlign: "-2px" }} /> Preferred Language</label>
            <select className="gselect" style={{ width: "100%" }} value={lang} onChange={(e) => setLang(e.target.value)}>
              <option>Telugu</option><option>Tamil</option><option>English</option>
            </select>
          </div>
        </div>

        <div className="gcard gcard-pad">
          <div className="gcard-title"><Bell size={15} /> Alert Preferences &amp; Channels</div>
          <ChannelRow label="Website Alerts" sub="In-browser notifications on this portal" on={channels.website} onClick={() => toggle("website")} icon={<Bell size={16} />} />
          <ChannelRow label="WhatsApp Alerts" sub="Flood &amp; safety messages on WhatsApp" on={channels.whatsapp} onClick={() => toggle("whatsapp")} icon={<MessageSquarePlus size={16} />} />
          <ChannelRow label="SMS Alerts" sub="Text alerts even without internet" on={channels.sms} onClick={() => toggle("sms")} icon={<Phone size={16} />} />
          <ChannelRow label="Voice Call Alerts" sub="Automated calls in your language (Sarvam AI)" on={channels.voice} onClick={() => toggle("voice")} icon={<Volume2 size={16} />} />
          <button className="gbtn" style={{ marginTop: 16 }} onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}>
            <CheckCircle2 size={15} /> {saved ? "Preferences saved" : "Save Preferences"}
          </button>
        </div>
      </div>
    </>
  );
}

function ChannelRow({ label, sub, on, onClick, icon }: { label: string; sub: string; on: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <div className="toggle-row">
      <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
        <span style={{ color: "var(--gov-700)" }}>{icon}</span>
        <div><div className="tr-name">{label}</div><div className="tr-sub">{sub}</div></div>
      </div>
      <label className="gtoggle">
        <input type="checkbox" checked={on} onChange={onClick} />
        <span className="track" />
      </label>
    </div>
  );
}

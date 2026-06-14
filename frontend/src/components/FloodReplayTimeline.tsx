import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Clock } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { Alert } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS, THRESHOLDS } from "../levels";

interface Props {
  alerts: Alert[];
  nodeId: string;
}

function timeAgo(ts: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function FloodReplayTimeline({ alerts, nodeId }: Props) {
  const events = alerts
    .filter((a) => a.node_id === nodeId)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const [cursor, setCursor] = useState(events.length > 0 ? events.length - 1 : 0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset cursor when node or alerts change
  useEffect(() => {
    setCursor(events.length > 0 ? events.length - 1 : 0);
    setPlaying(false);
  }, [nodeId, alerts.length]);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCursor((c) => {
          if (c >= events.length - 1) {
            setPlaying(false);
            return c;
          }
          return c + 1;
        });
      }, 800);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, events.length]);

  const active = events[cursor] ?? null;

  // Build chart data: all events up to cursor
  const chartData = events.slice(0, cursor + 1).map((e) => ({
    time: fmtTime(e.ts),
    distance_cm: e.distance_cm,
    forecast_cm: e.forecast_cm ?? null,
    level: e.flood_level,
  }));

  if (events.length === 0) {
    return (
      <div className="model-card">
        <div className="chart-header">
          <Clock size={16} />
          <h3>Flood Replay Timeline</h3>
        </div>
        <div className="chart-empty">No alert events recorded for this node yet.</div>
      </div>
    );
  }

  return (
    <div className="model-card">
      <div className="chart-header">
        <Clock size={16} />
        <h3>Flood Replay Timeline</h3>
        <span className="chart-status">{events.length} events · {nodeId}</span>
      </div>

      {/* Playback controls */}
      <div className="replay-controls">
        <button
          className="btn"
          onClick={() => { setCursor(0); setPlaying(false); }}
          title="Reset"
        >
          <RotateCcw size={13} />
        </button>
        <button
          className="btn"
          onClick={() => setPlaying((p) => !p)}
          disabled={cursor >= events.length - 1 && !playing}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={events.length - 1}
          value={cursor}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
          className="replay-scrubber"
        />
        <span className="replay-pos">{cursor + 1} / {events.length}</span>
      </div>

      {/* Active event card */}
      {active && (
        <div
          className="replay-event-card"
          style={{ borderLeft: `4px solid ${LEVEL_COLORS[active.flood_level]}` }}
        >
          <div className="replay-event-header">
            <span
              className="severity-badge"
              style={{ background: LEVEL_COLORS[active.flood_level] }}
            >
              {LEVEL_LABELS[active.flood_level]}
            </span>
            <span className="alert-time">{fmtTime(active.ts)} · {timeAgo(active.ts)}</span>
          </div>
          <div className="replay-event-body">
            <span>Water level: <strong>{active.distance_cm.toFixed(0)} cm</strong></span>
            {active.forecast_cm != null && (
              <span>2h forecast: <strong>{active.forecast_cm.toFixed(0)} cm</strong></span>
            )}
            {active.time_to_flood_min != null && active.time_to_flood_min < 120 && (
              <span>TTF: <strong>{active.time_to_flood_min.toFixed(0)} min</strong></span>
            )}
            {active.risk_class && (
              <span>ML risk: <strong>{active.risk_class}</strong></span>
            )}
          </div>
          {active.briefing && <p className="alert-briefing">{active.briefing}</p>}
        </div>
      )}

      {/* Replay chart */}
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="time" stroke="#64748b" fontSize={10} />
          <YAxis stroke="#64748b" fontSize={10} domain={[20, 150]} reversed />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0" }}
            formatter={(v: number, name: string) => [`${v.toFixed(1)} cm`, name === "distance_cm" ? "Actual" : "Forecast"]}
          />
          <ReferenceLine y={THRESHOLDS.red} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "RED", fill: "#ef4444", fontSize: 9 }} />
          <ReferenceLine y={THRESHOLDS.orange} stroke="#f97316" strokeDasharray="4 2" label={{ value: "ORANGE", fill: "#f97316", fontSize: 9 }} />
          <ReferenceLine y={THRESHOLDS.yellow} stroke="#eab308" strokeDasharray="4 2" label={{ value: "YELLOW", fill: "#eab308", fontSize: 9 }} />
          <Line type="monotone" dataKey="distance_cm" stroke="#38bdf8" dot={{ r: 3 }} strokeWidth={2} name="distance_cm" />
          <Line type="monotone" dataKey="forecast_cm" stroke="#818cf8" strokeDasharray="5 3" dot={false} strokeWidth={1.5} name="forecast_cm" />
        </LineChart>
      </ResponsiveContainer>

      {/* Event timeline strip */}
      <div className="replay-strip">
        {events.map((e, i) => (
          <button
            key={e.ts}
            className={`replay-pip${i === cursor ? " active" : ""}`}
            style={{ background: LEVEL_COLORS[e.flood_level], opacity: i > cursor ? 0.3 : 1 }}
            onClick={() => { setPlaying(false); setCursor(i); }}
            title={`${LEVEL_LABELS[e.flood_level]} · ${fmtTime(e.ts)}`}
          />
        ))}
      </div>
    </div>
  );
}

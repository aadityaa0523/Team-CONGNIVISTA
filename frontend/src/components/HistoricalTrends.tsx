import { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp } from "lucide-react";
import type { Alert } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../levels";

interface Props {
  alerts: Alert[];
  nodeId: string;
}

function dayKey(ts: string): string {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function HistoricalTrends({ alerts, nodeId }: Props) {
  const events = alerts.filter((a) => a.node_id === nodeId);

  // ── 1. Flood frequency by day ─────────────────────────────────────────────
  const frequencyData = useMemo(() => {
    const buckets: Record<string, Record<string, number>> = {};
    events.forEach((a) => {
      const day = dayKey(a.ts);
      if (!buckets[day]) buckets[day] = { green: 0, yellow: 0, orange: 0, red: 0 };
      buckets[day][a.flood_level] = (buckets[day][a.flood_level] ?? 0) + 1;
    });
    return Object.entries(buckets)
      .slice(-14) // last 14 days
      .map(([date, counts]) => ({ date, ...counts }));
  }, [events]);

  // ── 2. Average water level trend ─────────────────────────────────────────
  const levelTrend = useMemo(() => {
    const buckets: Record<string, number[]> = {};
    events.forEach((a) => {
      const day = dayKey(a.ts);
      if (!buckets[day]) buckets[day] = [];
      buckets[day].push(a.distance_cm);
    });
    return Object.entries(buckets)
      .slice(-14)
      .map(([date, vals]) => ({
        date,
        avg_cm: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length),
        min_cm: Math.min(...vals),
        max_cm: Math.max(...vals),
      }));
  }, [events]);

  // ── 3. Recovery stats ─────────────────────────────────────────────────────
  const recoveryData = useMemo(() => {
    return events
      .filter((a) => a.time_to_flood_min != null)
      .slice(-10)
      .map((a, i) => ({
        event: `#${i + 1}`,
        ttf_min: a.time_to_flood_min,
        level: a.flood_level,
      }));
  }, [events]);

  // ── 4. Summary stats ─────────────────────────────────────────────────────
  const total = events.length;
  const redCount = events.filter((a) => a.flood_level === "red").length;
  const avgDist = total > 0
    ? (events.reduce((s, a) => s + a.distance_cm, 0) / total).toFixed(1)
    : "—";
  const worstTTF = events
    .filter((a) => a.time_to_flood_min != null)
    .reduce((m, a) => Math.min(m, a.time_to_flood_min!), Infinity);

  if (events.length === 0) {
    return (
      <div className="model-card">
        <div className="chart-header">
          <TrendingUp size={16} />
          <h3>Historical Trend Analytics</h3>
        </div>
        <div className="chart-empty">No historical alert data for this node yet.</div>
      </div>
    );
  }

  return (
    <div className="model-card trends-card">
      <div className="chart-header">
        <TrendingUp size={16} />
        <h3>Historical Trend Analytics</h3>
        <span className="chart-status">{nodeId}</span>
      </div>

      {/* Summary row */}
      <div className="score-row">
        <div className="score-card">
          <span className="score-value">{total}</span>
          <span className="score-label">Total Alerts</span>
        </div>
        <div className="score-card">
          <span className="score-value" style={{ color: "#ef4444" }}>{redCount}</span>
          <span className="score-label">Critical Events</span>
        </div>
        <div className="score-card">
          <span className="score-value">{avgDist} cm</span>
          <span className="score-label">Avg Water Level</span>
        </div>
        <div className="score-card">
          <span className="score-value" style={{ color: "#f97316" }}>
            {worstTTF === Infinity ? "—" : `${worstTTF.toFixed(0)}m`}
          </span>
          <span className="score-label">Shortest TTF</span>
        </div>
      </div>

      <div className="model-split">
        {/* Flood frequency bar chart */}
        <div className="importance">
          <h4>Alert Frequency (by day)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={frequencyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
              <YAxis stroke="#64748b" fontSize={10} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0" }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {(["yellow", "orange", "red"] as const).map((lvl) => (
                <Bar key={lvl} dataKey={lvl} stackId="a" fill={LEVEL_COLORS[lvl]} name={LEVEL_LABELS[lvl]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Avg water level trend */}
        <div className="importance">
          <h4>Water Level Trend (avg per day)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={levelTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
              <YAxis stroke="#64748b" fontSize={10} reversed domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0" }}
                formatter={(v: number) => [`${v} cm`]}
              />
              <Line type="monotone" dataKey="avg_cm" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} name="Avg" />
              <Line type="monotone" dataKey="min_cm" stroke="#22c55e" strokeDasharray="4 2" dot={false} name="Min" />
              <Line type="monotone" dataKey="max_cm" stroke="#ef4444" strokeDasharray="4 2" dot={false} name="Max" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TTF recovery chart */}
      {recoveryData.length > 0 && (
        <div>
          <h4>Time-to-Flood per Event (last 10)</h4>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={recoveryData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="event" stroke="#64748b" fontSize={10} />
              <YAxis stroke="#64748b" fontSize={10} unit="m" />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0" }}
                formatter={(v: number) => [`${v.toFixed(0)} min`, "TTF"]}
              />
              <Bar
                dataKey="ttf_min"
                name="TTF (min)"
                radius={[4, 4, 0, 0]}
                fill="#818cf8"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

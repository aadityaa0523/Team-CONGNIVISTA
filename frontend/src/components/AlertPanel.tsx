import { AlertTriangle, BellRing } from "lucide-react";
import type { Alert } from "../types";
import { LEVEL_COLORS, LEVEL_LABELS } from "../levels";

interface Props {
  alerts: Alert[];
}

function timeAgo(ts: string): string {
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AlertPanel({ alerts }: Props) {
  return (
    <div className="alert-card">
      <div className="alert-header">
        <BellRing size={16} />
        <h3>Live Alerts</h3>
        <span className="alert-count">{alerts.length}</span>
      </div>

      {alerts.length === 0 ? (
        <div className="alert-empty">
          <AlertTriangle size={18} />
          No alerts. All monitored nodes are within safe levels.
        </div>
      ) : (
        <ul className="alert-list">
          {alerts.map((a, i) => (
            <li key={`${a.node_id}-${a.ts}-${i}`} className="alert-row">
              <span
                className="severity-badge"
                style={{ background: LEVEL_COLORS[a.flood_level] ?? "#64748b" }}
              >
                {LEVEL_LABELS[a.flood_level] ?? a.flood_level}
              </span>
              <div className="alert-body">
                <div className="alert-line">
                  <strong>{a.node_id}</strong>
                  <span className="alert-time">{timeAgo(a.ts)}</span>
                </div>
                <div className="alert-detail">
                  {a.distance_cm?.toFixed(0)} cm now
                  {a.forecast_cm != null && (
                    <> → {a.forecast_cm.toFixed(0)} cm in 2 h</>
                  )}
                </div>
                {a.briefing && <p className="alert-briefing">{a.briefing}</p>}
                <div className="alert-channels">
                  {a.risk_class && <span className="channel-chip">ML: {a.risk_class}</span>}
                  {a.sewer_safety && a.sewer_safety.sewer_safety_index !== "SAFE" && (
                    <span className="channel-chip">
                      Sewer: {a.sewer_safety.sewer_safety_index}
                    </span>
                  )}
                  {a.time_to_flood_min != null && a.time_to_flood_min < 120 && (
                    <span className="channel-chip">TTF: {a.time_to_flood_min}m</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

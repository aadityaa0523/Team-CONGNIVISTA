import { Activity, HeartPulse, ShieldAlert } from "lucide-react";
import type { Drain } from "../types";
import { riskScoreColor, stressColor } from "../levels";

interface Props {
  drain: Drain | null;
}

function Metric({
  label,
  value,
  suffix = "",
  color,
}: {
  label: string;
  value: number | string | undefined;
  suffix?: string;
  color?: string;
}) {
  return (
    <div className="twin-metric">
      <span className="twin-metric-label">{label}</span>
      <span className="twin-metric-value" style={color ? { color } : undefined}>
        {value === undefined || value === null ? "—" : value}
        {value !== undefined && value !== null ? suffix : ""}
      </span>
    </div>
  );
}

export default function DrainTwinPanel({ drain }: Props) {
  if (!drain) {
    return (
      <div className="twin-card">
        <div className="twin-header">
          <Activity size={16} />
          <h3>Digital Twin</h3>
        </div>
        <div className="twin-empty">Select a drain node to view its asset profile.</div>
      </div>
    );
  }

  const fill = drain.fill_pct ?? 0;
  const overflow = drain.overflow_threshold_cm ?? 85;
  const level = drain.current_water_level_cm ?? 0;
  const margin = Math.max(0, overflow - level);

  return (
    <div className="twin-card">
      <div className="twin-header">
        <Activity size={16} />
        <h3>{drain.name ?? drain.drain_id}</h3>
        {drain.ward && <span className="twin-ward">{drain.ward}</span>}
      </div>

      <div className="twin-grid">
        <Metric label="Fill" value={fill.toFixed(0)} suffix="%" color={stressColor(drain.stress_category ?? "SAFE")} />
        <Metric
          label="Stress Index"
          value={drain.stress_index}
          color={stressColor(drain.stress_category ?? "SAFE")}
        />
        <Metric
          label="Health"
          value={drain.health_label ?? drain.health_score}
          color={drain.health_score != null ? riskScoreColor(100 - drain.health_score) : undefined}
        />
        <Metric label="Overflow Margin" value={margin.toFixed(0)} suffix=" cm" />
        <Metric
          label="Risk Score"
          value={drain.risk_score}
          color={drain.risk_score != null ? riskScoreColor(drain.risk_score) : undefined}
        />
        <Metric label="Criticality" value={drain.criticality_score} />
      </div>

      <div className="twin-foot">
        <span>
          <HeartPulse size={13} /> Pop. served:{" "}
          {drain.population_served?.toLocaleString() ?? "—"}
        </span>
        {drain.infrastructure_nearby && drain.infrastructure_nearby.length > 0 && (
          <span className="twin-infra">
            <ShieldAlert size={13} />
            {drain.infrastructure_nearby.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

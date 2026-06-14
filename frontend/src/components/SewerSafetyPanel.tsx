import { HardHat, Wind } from "lucide-react";
import { classifySewer, SEWER_CLEARANCE, SEWER_COLORS, SEWER_THRESHOLDS } from "../levels";

interface Props {
  methanePpm: number | null;
}

export default function SewerSafetyPanel({ methanePpm }: Props) {
  const ppm = methanePpm ?? 0;
  const index = classifySewer(ppm);
  const color = SEWER_COLORS[index];
  const clearance = SEWER_CLEARANCE[index];

  // Gauge fill: 0..1 across 0..critical+ range.
  const gaugeMax = SEWER_THRESHOLDS.critical * 1.2;
  const pct = Math.max(0, Math.min(1, ppm / gaugeMax));

  return (
    <div className="sewer-card">
      <div className="sewer-header">
        <Wind size={16} />
        <h3>Sewer Safety</h3>
        <span className="sewer-badge" style={{ background: color }}>
          {index}
        </span>
      </div>

      <div className="sewer-readout">
        <span className="sewer-ppm" style={{ color }}>
          {methanePpm == null ? "—" : ppm.toFixed(0)}
        </span>
        <span className="sewer-unit">ppm CH₄</span>
      </div>

      <div className="sewer-gauge">
        <div
          className="sewer-gauge-fill"
          style={{ width: `${pct * 100}%`, background: color }}
        />
        {/* threshold ticks */}
        {(["caution", "danger", "critical"] as const).map((k) => (
          <div
            key={k}
            className="sewer-tick"
            style={{ left: `${(SEWER_THRESHOLDS[k] / gaugeMax) * 100}%` }}
            title={`${k}: ${SEWER_THRESHOLDS[k]} ppm`}
          />
        ))}
      </div>

      <div className="sewer-clearance" style={{ borderColor: color }}>
        <HardHat size={16} style={{ color }} />
        <span>{clearance}</span>
      </div>
    </div>
  );
}

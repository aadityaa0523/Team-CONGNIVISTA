import { useState } from "react";
import { FlaskConical, Play } from "lucide-react";
import { runSimulation, type SimulateInput } from "../api";
import type { SimulateResult } from "../types";
import { RISK_COLORS } from "../levels";

const DEFAULTS: SimulateInput = {
  water_level_cm: 60,
  capacity_cm: 100,
  rise_rate_cm_per_min: 0.5,
  methane_ppm: 100,
  rainfall_mm: 5,
  hour_of_day: 12,
};

interface SliderDef {
  key: keyof SimulateInput;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

const SLIDERS: SliderDef[] = [
  { key: "water_level_cm", label: "Water level", min: 0, max: 120, step: 1, unit: "cm" },
  { key: "capacity_cm", label: "Capacity", min: 40, max: 200, step: 5, unit: "cm" },
  { key: "rise_rate_cm_per_min", label: "Rise rate", min: 0, max: 10, step: 0.1, unit: "cm/min" },
  { key: "rainfall_mm", label: "Rainfall", min: 0, max: 50, step: 1, unit: "mm" },
  { key: "methane_ppm", label: "Methane", min: 0, max: 1200, step: 10, unit: "ppm" },
  { key: "hour_of_day", label: "Hour of day", min: 0, max: 23, step: 1, unit: "h" },
];

export default function WhatIfSimulator() {
  const [input, setInput] = useState<SimulateInput>(DEFAULTS);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await runSimulation(input));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setBusy(false);
    }
  };

  const riskColor = result ? RISK_COLORS[result.flood_risk.class] : "#64748b";

  return (
    <div className="sim-card">
      <div className="chart-header">
        <FlaskConical size={16} />
        <h3>What-If Simulator</h3>
      </div>

      <div className="sim-split">
        <div className="sim-sliders">
          {SLIDERS.map((s) => (
            <div key={s.key} className="sim-slider">
              <label>
                {s.label}
                <span className="sim-val">
                  {input[s.key]} {s.unit}
                </span>
              </label>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={input[s.key]}
                onChange={(e) =>
                  setInput({ ...input, [s.key]: Number(e.target.value) })
                }
              />
            </div>
          ))}
          <button className="btn sim-run" onClick={run} disabled={busy}>
            <Play size={14} />
            {busy ? "Running…" : "Run Simulation"}
          </button>
          {error && <div className="chart-status err">{error}</div>}
        </div>

        <div className="sim-results">
          {!result ? (
            <div className="chart-empty">Adjust inputs and run to see predictions.</div>
          ) : (
            <>
              <div className="sim-risk" style={{ borderColor: riskColor }}>
                <span className="sim-risk-class" style={{ color: riskColor }}>
                  {result.flood_risk.class}
                </span>
                <span className="sim-risk-prob">
                  {(result.flood_risk.probability * 100).toFixed(0)}% confidence
                </span>
              </div>
              <div className="sim-metrics">
                <div>
                  <span className="sim-metric-label">Fill</span>
                  <span className="sim-metric-value">{result.fill_pct}%</span>
                </div>
                <div>
                  <span className="sim-metric-label">Time to flood</span>
                  <span className="sim-metric-value">{result.time_to_flood_min} min</span>
                </div>
                <div>
                  <span className="sim-metric-label">Recovery</span>
                  <span className="sim-metric-value">{result.recovery_min} min</span>
                </div>
              </div>
              {result.anomaly.detected && (
                <div className="sim-anomaly">⚠️ {result.anomaly.reason}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

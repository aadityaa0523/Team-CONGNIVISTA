import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchModelMetrics } from "../api";
import type { ModelMetrics } from "../types";
import { RISK_COLORS } from "../levels";

function ScoreCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-card">
      <span className="score-value">{(value * 100).toFixed(1)}%</span>
      <span className="score-label">{label}</span>
    </div>
  );
}

export default function ModelDashboard() {
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModelMetrics()
      .then(setMetrics)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load metrics"));
  }, []);

  if (error) return <div className="model-card"><div className="chart-empty err">{error}</div></div>;
  if (!metrics) return <div className="model-card"><div className="chart-empty">Loading model metrics…</div></div>;

  const { classifier: c, ttf_regressor, feature_importance } = metrics;

  return (
    <div className="model-card">
      <div className="chart-header">
        <h3>Flood Risk Classifier — Evaluation</h3>
        <span className="chart-status">
          {metrics.n_train} train / {metrics.n_test} test
        </span>
      </div>

      <div className="score-row">
        <ScoreCard label="Accuracy" value={c.accuracy} />
        <ScoreCard label="Precision" value={c.precision} />
        <ScoreCard label="Recall" value={c.recall} />
        <ScoreCard label="F1" value={c.f1} />
        <div className="score-card">
          <span className="score-value">{ttf_regressor.rmse_min}</span>
          <span className="score-label">TTF RMSE (min)</span>
        </div>
      </div>

      <div className="model-split">
        <div className="confusion">
          <h4>Confusion Matrix</h4>
          <table>
            <thead>
              <tr>
                <th></th>
                {c.labels.map((l) => (
                  <th key={l}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.confusion_matrix.map((row, i) => (
                <tr key={i}>
                  <th>{c.labels[i]}</th>
                  {row.map((v, j) => (
                    <td
                      key={j}
                      className={i === j ? "diag" : ""}
                      style={i === j ? { color: RISK_COLORS[c.labels[i] as keyof typeof RISK_COLORS] } : undefined}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <span className="confusion-note">rows = actual · columns = predicted</span>
        </div>

        <div className="importance">
          <h4>Feature Importance</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              layout="vertical"
              data={feature_importance}
              margin={{ left: 30, right: 16, top: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" stroke="#64748b" fontSize={11} />
              <YAxis
                type="category"
                dataKey="feature"
                stroke="#64748b"
                fontSize={10}
                width={110}
              />
              <Tooltip
                contentStyle={{
                  background: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: 8,
                  color: "#e2e8f0",
                }}
              />
              <Bar dataKey="importance" fill="#38bdf8" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastStep, Reading } from "../types";
import { LEVEL_COLORS, THRESHOLDS } from "../levels";

interface Props {
  readings: Reading[];
  forecast: ForecastStep[];
  loading: boolean;
  error: string | null;
}

interface Point {
  t: number; // epoch ms (x axis)
  historical?: number;
  forecast?: number;
}

const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function ForecastChart({
  readings,
  forecast,
  loading,
  error,
}: Props) {
  const { data, domain } = useMemo(() => {
    const hist: Point[] = readings.map((r) => ({
      t: new Date(r.time).getTime(),
      historical: r.distance_cm,
    }));

    const fc: Point[] = forecast.map((f) => ({
      t: new Date(f.ts).getTime(),
      forecast: f.distance_cm_predicted,
    }));

    // Bridge the two lines so the dashed forecast visually continues from
    // the last historical point.
    if (hist.length && fc.length) {
      const last = hist[hist.length - 1];
      last.forecast = last.historical;
    }

    const merged = [...hist, ...fc].sort((a, b) => a.t - b.t);
    const ts = merged.map((p) => p.t);
    const dom: [number, number] =
      ts.length > 0 ? [Math.min(...ts), Math.max(...ts)] : [0, 1];
    return { data: merged, domain: dom };
  }, [readings, forecast]);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h3>2-Hour Forecast — ARIMAX(2,1,2)</h3>
        {loading && <span className="chart-status">loading…</span>}
        {error && <span className="chart-status err">{error}</span>}
      </div>

      {data.length === 0 && !loading ? (
        <div className="chart-empty">
          No readings yet. Publish sensor data or train the model.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={data}
            margin={{ top: 10, right: 20, bottom: 4, left: -10 }}
          >
            {/* Threshold bands. Lower distance = higher water, so dangerous
                zones sit at the BOTTOM of the Y axis. */}
            <ReferenceArea
              y1={0}
              y2={THRESHOLDS.red}
              fill={LEVEL_COLORS.red}
              fillOpacity={0.12}
            />
            <ReferenceArea
              y1={THRESHOLDS.red}
              y2={THRESHOLDS.orange}
              fill={LEVEL_COLORS.orange}
              fillOpacity={0.1}
            />
            <ReferenceArea
              y1={THRESHOLDS.orange}
              y2={THRESHOLDS.yellow}
              fill={LEVEL_COLORS.yellow}
              fillOpacity={0.1}
            />
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="t"
              type="number"
              domain={domain}
              scale="time"
              tickFormatter={fmtTime}
              stroke="#64748b"
              fontSize={11}
            />
            <YAxis
              stroke="#64748b"
              fontSize={11}
              label={{
                value: "cm",
                angle: -90,
                position: "insideLeft",
                fill: "#64748b",
                fontSize: 11,
              }}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: 8,
                color: "#e2e8f0",
              }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
              formatter={(v: number) => [`${v?.toFixed(1)} cm`]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              name="Historical"
              type="monotone"
              dataKey="historical"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              name="Forecast (2 h)"
              type="monotone"
              dataKey="forecast"
              stroke="#a855f7"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: "#a855f7" }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

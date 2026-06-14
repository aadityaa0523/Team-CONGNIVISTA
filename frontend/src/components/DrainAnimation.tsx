import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { stressColor } from "../levels";

interface Props {
  drainName: string;
  fillPct: number | null; // 0–100
  stressCategory?: string; // SAFE / WATCH / WARNING / CRITICAL
}

const W = 460;
const H = 320;
const MARGIN = { top: 28, bottom: 28 };

/**
 * D3 urban-drain cross-section. A box culvert whose water column fills from the
 * bottom; the surface animates with a small wave via requestAnimationFrame and
 * the fill height eases between updates.
 */
export default function DrainAnimation({ drainName, fillPct, stressCategory }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fillRef = useRef(0);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const bedTop = MARGIN.top;
    const bedBottom = H - MARGIN.bottom;
    const bedHeight = bedBottom - bedTop;
    const yForFill = (f: number) => bedBottom - f * bedHeight;

    // Culvert walls.
    svg
      .append("rect")
      .attr("x", 0)
      .attr("y", bedTop)
      .attr("width", W)
      .attr("height", bedHeight)
      .attr("fill", "#0b1f33")
      .attr("rx", 8)
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 2);

    // Overflow line (capacity).
    svg
      .append("line")
      .attr("x1", 0)
      .attr("x2", W)
      .attr("y1", yForFill(0.85))
      .attr("y2", yForFill(0.85))
      .attr("stroke", "#ef4444")
      .attr("stroke-dasharray", "5 5")
      .attr("stroke-opacity", 0.5);
    svg
      .append("text")
      .attr("x", W - 6)
      .attr("y", yForFill(0.85) - 4)
      .attr("text-anchor", "end")
      .attr("fill", "#ef4444")
      .attr("font-size", 10)
      .attr("opacity", 0.8)
      .text("Overflow 85%");

    const color = fillPct == null ? "#334155" : stressColor(stressCategory ?? "SAFE");

    const water = svg.append("path").attr("fill", color).attr("opacity", 0.85);
    const cap = svg
      .append("rect")
      .attr("x", 0)
      .attr("width", W)
      .attr("height", 3)
      .attr("fill", color)
      .attr("opacity", 0.95);

    const wavePath = (f: number, phase: number): string => {
      const yBase = yForFill(f);
      const amp = 5;
      const pts: [number, number][] = [];
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * W;
        const y = yBase + Math.sin((i / steps) * Math.PI * 4 + phase) * amp;
        pts.push([x, y]);
      }
      const line = d3.line().curve(d3.curveBasis);
      return `${line(pts) ?? ""} L ${W} ${bedBottom} L 0 ${bedBottom} Z`;
    };

    const target = fillPct == null ? 0 : Math.max(0, Math.min(1, fillPct / 100));
    const from = fillRef.current;
    fillRef.current = target;

    let raf = 0;
    let phase = 0;
    const t0 = performance.now();
    const DUR = 1100;
    const render = (now: number) => {
      const k = Math.min(1, (now - t0) / DUR);
      const f = from + (target - from) * d3.easeCubicOut(k);
      phase += 0.04;
      water.attr("d", wavePath(f, phase));
      cap.attr("y", yForFill(f) - 1);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [fillPct, stressCategory]);

  return (
    <div className="river-card">
      <div className="river-header">
        <div>
          <h3>{drainName}</h3>
          <span className="river-sub">Drain culvert · fill level</span>
        </div>
        <div className="river-readout">
          <div className="river-distance">
            {fillPct == null ? "—" : `${fillPct.toFixed(0)}%`}
          </div>
          {stressCategory && (
            <span
              className="level-badge"
              style={{ background: stressColor(stressCategory) }}
            >
              {stressCategory}
            </span>
          )}
        </div>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="river-svg" />
      <div className="river-foot">Fill % of capacity — overflow risk above 85%.</div>
    </div>
  );
}

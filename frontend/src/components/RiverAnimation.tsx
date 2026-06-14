import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { classify, distanceToFill, LEVEL_COLORS, LEVEL_LABELS } from "../levels";

interface Props {
  nodeLabel: string;
  distanceCm: number | null;
}

const W = 460;
const H = 320;
const MARGIN = { top: 28, bottom: 28 };

/**
 * D3 river cross-section. A filled <path> represents the water surface and
 * animates its height up/down with d3.transition whenever distanceCm changes.
 * A second offset wave path gives a subtle moving-water feel.
 */
export default function RiverAnimation({ nodeLabel, distanceCm }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fillRef = useRef(0); // last rendered fill fraction, for smooth transitions

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const bedTop = MARGIN.top;
    const bedBottom = H - MARGIN.bottom;
    const bedHeight = bedBottom - bedTop;

    // Channel background (the empty river bed).
    const defs = svg.append("defs");
    const grad = defs
      .append("linearGradient")
      .attr("id", "waterGrad")
      .attr("x1", "0")
      .attr("y1", "0")
      .attr("x2", "0")
      .attr("y2", "1");
    grad.append("stop").attr("offset", "0%").attr("stop-opacity", 0.95);
    grad.append("stop").attr("offset", "100%").attr("stop-opacity", 0.6);

    svg
      .append("rect")
      .attr("x", 0)
      .attr("y", bedTop)
      .attr("width", W)
      .attr("height", bedHeight)
      .attr("fill", "#0b1f33")
      .attr("rx", 8);

    // Gridlines for the three thresholds, drawn at their fill fractions.
    const thresholdMarks = [
      { label: "Watch", dist: 80 },
      { label: "Warning", dist: 60 },
      { label: "Critical", dist: 40 },
    ];
    const yForFill = (fill: number) => bedBottom - fill * bedHeight;
    thresholdMarks.forEach((m) => {
      const y = yForFill(distanceToFill(m.dist));
      svg
        .append("line")
        .attr("x1", 0)
        .attr("x2", W)
        .attr("y1", y)
        .attr("y2", y)
        .attr("stroke", "#ffffff")
        .attr("stroke-dasharray", "4 4")
        .attr("stroke-opacity", 0.18);
      svg
        .append("text")
        .attr("x", W - 6)
        .attr("y", y - 4)
        .attr("text-anchor", "end")
        .attr("fill", "#94a3b8")
        .attr("font-size", 10)
        .text(m.label);
    });

    // The animated water path.
    const water = svg
      .append("path")
      .attr("fill", "url(#waterGrad)")
      .attr("stroke", "none");

    const surfaceCap = svg
      .append("rect")
      .attr("x", 0)
      .attr("width", W)
      .attr("height", 3)
      .attr("opacity", 0.9);

    // Build a wavy surface path for a given fill fraction and horizontal phase.
    const wavePath = (fill: number, phase: number): string => {
      const yBase = yForFill(fill);
      const amp = 6;
      const points: [number, number][] = [];
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * W;
        const y = yBase + Math.sin(i / steps * Math.PI * 4 + phase) * amp;
        points.push([x, y]);
      }
      const line = d3.line().curve(d3.curveBasis);
      const top = line(points) ?? "";
      return `${top} L ${W} ${bedBottom} L 0 ${bedBottom} Z`;
    };

    const targetFill =
      distanceCm == null ? 0 : distanceToFill(distanceCm);
    const color =
      distanceCm == null ? "#334155" : LEVEL_COLORS[classify(distanceCm)];

    water.attr("fill", color).attr("opacity", 0.85);
    surfaceCap.attr("fill", color);

    // Animate fill from previous value to the new target.
    const fromFill = fillRef.current;
    fillRef.current = targetFill;

    let raf = 0;
    let phase = 0;
    const t0 = performance.now();
    const DUR = 1200;

    const render = (now: number) => {
      const k = Math.min(1, (now - t0) / DUR);
      const ease = d3.easeCubicOut(k);
      const fill = fromFill + (targetFill - fromFill) * ease;
      phase += 0.04;
      water.attr("d", wavePath(fill, phase));
      surfaceCap.attr("y", yForFill(fill) - 1);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => cancelAnimationFrame(raf);
  }, [distanceCm]);

  const level = distanceCm == null ? null : classify(distanceCm);

  return (
    <div className="river-card">
      <div className="river-header">
        <div>
          <h3>{nodeLabel}</h3>
          <span className="river-sub">River / Drain cross-section</span>
        </div>
        <div className="river-readout">
          <div className="river-distance">
            {distanceCm == null ? "—" : `${distanceCm.toFixed(1)} cm`}
          </div>
          {level && (
            <span
              className="level-badge"
              style={{ background: LEVEL_COLORS[level] }}
            >
              {LEVEL_LABELS[level]}
            </span>
          )}
        </div>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="river-svg" />
      <div className="river-foot">
        Distance to water surface — lower value means higher water.
      </div>
    </div>
  );
}

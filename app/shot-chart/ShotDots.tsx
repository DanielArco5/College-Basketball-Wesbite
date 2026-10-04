import {
  toSvg,
  VIEW_W,
  VIEW_H,
  PX_PER_FT,
  COURT_WIDTH_FT,
  VIEW_DEPTH_FT,
  BASKET_X_FT,
  BASKET_Y_FT,
  THREE_POINT_RADIUS_FT,
  CORNER_3_INSET_FT,
  CORNER_3_BREAK_FT,
  RESTRICTED_AREA_FT,
  LANE_HALF_WIDTH_FT,
  LANE_DEPTH_FT,
} from "@/lib/court";

export type Shot = { x: number; y: number; made: boolean };

// toSvg's return shape isn't pinned down in the export list — this accepts
// either [x, y] or {x, y}. If it's one or the other, inline it and delete this.
function pt(cx: number, cy: number): { x: number; y: number } {
  const r = toSvg(cx, cy) as unknown;
  return Array.isArray(r)
    ? { x: r[0] as number, y: r[1] as number }
    : (r as { x: number; y: number });
}

/**
 * Individual shot locations rather than zone aggregates.
 *
 * These coordinates come from courtside scorers marking a spot, not from
 * optical tracking, so they're good to a foot or two — enough for "left
 * wing, about 16 feet," not enough to read precisely. That's also why a
 * handful of shots land in geometrically impossible places.
 */
export default function ShotDots({ shots }: { shots: Shot[] }) {
  const made = shots.filter((s) => s.made);
  const missed = shots.filter((s) => !s.made);

  // Opacity carries density: where a player lives, dots stack into a solid
  // mass, and that massing is the thing worth seeing.
  const alpha = shots.length > 400 ? 0.4 : shots.length > 150 ? 0.55 : 0.75;
  const r = shots.length > 600 ? 2.2 : 2.8;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="court"
      role="img"
      aria-label={`${shots.length} shot locations`}
    >
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} className="court-floor" />
      <CourtLines />

      {/* Misses first, so makes read on top where they overlap. */}
      <g className="dots-missed">
        {missed.map((s, i) => {
          const p = pt(s.x, s.y);
          return (
            <circle
              key={`m${i}`}
              cx={p.x}
              cy={p.y}
              r={r}
              fill="none"
              stroke="var(--miss, #8C7B6B)"
              strokeWidth={1}
              opacity={alpha}
            />
          );
        })}
      </g>

      <g className="dots-made">
        {made.map((s, i) => {
          const p = pt(s.x, s.y);
          return (
            <circle
              key={`h${i}`}
              cx={p.x}
              cy={p.y}
              r={r}
              fill="var(--accent, #C8503C)"
              opacity={alpha}
            />
          );
        })}
      </g>
    </svg>
  );
}

/**
 * Court markings, drawn from the same constants the zone logic uses.
 * This duplicates the line drawing inside ShotChart — if you'd rather have
 * one copy, the fix is to pull a shared <CourtLines/> out of that file.
 */
function CourtLines() {
  const line = { fill: "none", stroke: "var(--line, #6B5D4F)", strokeWidth: 1.5 };

  const hoop = pt(BASKET_X_FT, BASKET_Y_FT);
  const leftSideline = pt(0, 0);
  const rightSideline = pt(0, COURT_WIDTH_FT);

  // Three-point arc: from where it breaks off the corner straightaways
  // round to the other side.
  const arcStart = pt(CORNER_3_BREAK_FT, CORNER_3_INSET_FT);
  const arcEnd = pt(CORNER_3_BREAK_FT, COURT_WIDTH_FT - CORNER_3_INSET_FT);
  const arcR = THREE_POINT_RADIUS_FT * PX_PER_FT;

  const laneNear = pt(0, BASKET_Y_FT - LANE_HALF_WIDTH_FT);
  const laneFar = pt(LANE_DEPTH_FT, BASKET_Y_FT + LANE_HALF_WIDTH_FT);
  const laneTop = pt(LANE_DEPTH_FT, BASKET_Y_FT - LANE_HALF_WIDTH_FT);

  return (
    <g className="court-lines">
      {/* baseline */}
      <line
        x1={leftSideline.x}
        y1={leftSideline.y}
        x2={rightSideline.x}
        y2={rightSideline.y}
        {...line}
      />

      {/* corner three straightaways */}
      <line
        x1={pt(0, CORNER_3_INSET_FT).x}
        y1={pt(0, CORNER_3_INSET_FT).y}
        x2={arcStart.x}
        y2={arcStart.y}
        {...line}
      />
      <line
        x1={pt(0, COURT_WIDTH_FT - CORNER_3_INSET_FT).x}
        y1={pt(0, COURT_WIDTH_FT - CORNER_3_INSET_FT).y}
        x2={arcEnd.x}
        y2={arcEnd.y}
        {...line}
      />

      {/* three-point arc */}
      <path
        d={`M ${arcStart.x} ${arcStart.y} A ${arcR} ${arcR} 0 0 1 ${arcEnd.x} ${arcEnd.y}`}
        {...line}
      />

      {/* lane */}
      <rect
        x={Math.min(laneNear.x, laneFar.x)}
        y={Math.min(laneTop.y, laneFar.y)}
        width={Math.abs(laneFar.x - laneNear.x)}
        height={Math.abs(laneFar.y - laneTop.y)}
        {...line}
      />

      {/* restricted area */}
      <circle
        cx={hoop.x}
        cy={hoop.y}
        r={RESTRICTED_AREA_FT * PX_PER_FT}
        {...line}
        strokeDasharray="3 3"
      />

      {/* rim */}
      <circle cx={hoop.x} cy={hoop.y} r={0.75 * PX_PER_FT} {...line} />
    </g>
  );
}

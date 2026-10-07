import {
  BASKET_Y_FT,
  BUCKET_COLORS,
  CORNER_3_BREAK_FT,
  CORNER_3_INSET_FT,
  HOOP,
  NO_DATA_PATTERN_ID,
  LANE_DEPTH_FT,
  LANE_HALF_WIDTH_FT,
  PX_PER_FT,
  RESTRICTED_AREA_FT,
  THREE_POINT_RADIUS_FT,
  WING_SPLIT_DEG,
  VIEW_H,
  VIEW_W,
  toSvg,
  type Zone,
} from "@/lib/court";

export type ZoneStat = {
  zone: Zone;
  attempts: number;
  makes: number;
  raw_fg_pct: number;
  fg_pct: number;
  league_fg_pct: number;
  fg_pct_vs_league: number;
  color_bucket: string;
};

// Lines are drawn in a near-black a shade under the surface, so they read
// as gaps between zones and hold up on every fill from glacier to stone.
const LINE = "#16110D";
const SURFACE = "#241C16";

// Zone boundaries in SVG pixels, from the same constants zoneOf() uses.
const ARC_R = THREE_POINT_RADIUS_FT * PX_PER_FT;
const RA_R = RESTRICTED_AREA_FT * PX_PER_FT;
const CORNER_W = CORNER_3_INSET_FT * PX_PER_FT;
const CORNER_TOP = toSvg(CORNER_3_BREAK_FT, 0).sy;
const LANE_L = toSvg(0, BASKET_Y_FT - LANE_HALF_WIDTH_FT).sx;
const LANE_R = toSvg(0, BASKET_Y_FT + LANE_HALF_WIDTH_FT).sx;
const LANE_TOP = toSvg(LANE_DEPTH_FT, 0).sy;

// Rays from the hoop that split the wings from the top of the key, in SVG
// pixels: up the court and out to each side by WING_SPLIT_DEG.
const SPLIT = (WING_SPLIT_DEG * Math.PI) / 180;
const ray = (side: 1 | -1, len: number) => ({
  x: HOOP.sx + side * Math.sin(SPLIT) * len,
  y: HOOP.sy - Math.cos(SPLIT) * len,
});
const FAR = 1000; // long enough to leave the drawing in any direction

export default function ShotChart({ stats }: { stats: ZoneStat[] }) {
  const byZone = new Map(stats.map((s) => [s.zone, s]));

  const fillFor = (zone: Zone) => {
    const stat = byZone.get(zone);
    const bucket = stat?.color_bucket ?? "gray";
    return bucket === "gray" || !BUCKET_COLORS[bucket]
      ? `url(#${NO_DATA_PATTERN_ID})`
      : BUCKET_COLORS[bucket];
  };

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="court"
      role="img"
      aria-label="Shot chart by court zone"
    >
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill={SURFACE} />

      <defs>
        {/* Too few attempts to say: bare court with a faint diagonal hatch. */}
        <pattern
          id={NO_DATA_PATTERN_ID}
          width={7}
          height={7}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={7} height={7} fill={BUCKET_COLORS.gray} />
          <line x1={0} y1={0} x2={0} y2={7} stroke="#4A3F35" strokeWidth={1.5} />
        </pattern>
        <clipPath id="zone-inside-arc">
          <circle cx={HOOP.sx} cy={HOOP.sy} r={ARC_R} />
        </clipPath>
        <clipPath id="zone-between-corners">
          <rect x={CORNER_W} y={0} width={VIEW_W - 2 * CORNER_W} height={VIEW_H} />
        </clipPath>
      </defs>

      {/* Zone fills, as exact shapes painted back to front so each layer
          carves its zone out of the one beneath — the same precedence
          zoneOf() checks in, reversed. */}
      <g>
        {/* Above the break: top of the key, then a wedge for each wing.
            Higher court y is the shooter's left, which draws on the right. */}
        <rect width={VIEW_W} height={VIEW_H} fill={fillFor("top_3")} />
        <polygon
          points={`${HOOP.sx},${HOOP.sy} ${ray(1, FAR).x},${ray(1, FAR).y} ${VIEW_W + FAR},${ray(1, FAR).y} ${VIEW_W + FAR},${VIEW_H + FAR} ${HOOP.sx},${VIEW_H + FAR}`}
          fill={fillFor("wing_3_left")}
        />
        <polygon
          points={`${HOOP.sx},${HOOP.sy} ${ray(-1, FAR).x},${ray(-1, FAR).y} ${-FAR},${ray(-1, FAR).y} ${-FAR},${VIEW_H + FAR} ${HOOP.sx},${VIEW_H + FAR}`}
          fill={fillFor("wing_3_right")}
        />

        {/* Inside the arc and between the corner lines: mid-range. */}
        <g clipPath="url(#zone-between-corners)">
          <g clipPath="url(#zone-inside-arc)">
            <rect width={LANE_L} height={VIEW_H} fill={fillFor("mid_right")} />
            <rect
              x={LANE_L}
              width={LANE_R - LANE_L}
              height={VIEW_H}
              fill={fillFor("mid_center")}
            />
            <rect
              x={LANE_R}
              width={VIEW_W - LANE_R}
              height={VIEW_H}
              fill={fillFor("mid_left")}
            />
          </g>
        </g>

        <rect
          y={CORNER_TOP}
          width={CORNER_W}
          height={VIEW_H - CORNER_TOP}
          fill={fillFor("corner_3_right")}
        />
        <rect
          x={VIEW_W - CORNER_W}
          y={CORNER_TOP}
          width={CORNER_W}
          height={VIEW_H - CORNER_TOP}
          fill={fillFor("corner_3_left")}
        />

        <rect
          x={LANE_L}
          y={LANE_TOP}
          width={LANE_R - LANE_L}
          height={VIEW_H - LANE_TOP}
          fill={fillFor("paint_non_ra")}
        />
        <circle
          cx={HOOP.sx}
          cy={HOOP.sy}
          r={RA_R}
          fill={fillFor("restricted_area")}
        />
      </g>

      {/* Court markings, drawn over the fills so the geometry stays legible. */}
      <g fill="none" stroke={LINE} strokeWidth={2} strokeLinecap="square">
        {/* Boundary and baseline */}
        <rect x={1} y={1} width={VIEW_W - 2} height={VIEW_H - 2} />

        {/* Lane */}
        <rect x={190} y={130} width={120} height={190} />

        {/* Free throw circle */}
        <circle cx={250} cy={130} r={60} />

        {/* Restricted area */}
        <path d={`M 210 ${HOOP.sy} A 40 40 0 0 1 290 ${HOOP.sy}`} />

        {/* Three-point line: two corner segments and the arc between them */}
        <path d="M 33.4 320 L 33.4 221" />
        <path d="M 466.6 320 L 466.6 221" />
        <path d="M 33.4 221 A 221.458 221.458 0 0 1 466.6 221" />

        {/* Wing / top-of-key dividers, from the arc outward */}
        {([1, -1] as const).map((side) => (
          <line
            key={side}
            x1={ray(side, ARC_R).x}
            y1={ray(side, ARC_R).y}
            x2={ray(side, FAR).x}
            y2={ray(side, FAR).y}
            strokeWidth={1.25}
          />
        ))}

        {/* Backboard and rim */}
        <path d="M 220 280 L 280 280" strokeWidth={3} />
        <circle cx={250} cy={HOOP.sy} r={7.5} strokeWidth={2} />
      </g>
    </svg>
  );
}

/**
 * Key for the zone colors. The cutoffs mirror the color_bucket CASE in
 * supabase/zones-and-baselines.sql (players) and team-zones.sql (teams);
 * if those change, change these.
 */
const LEGEND_CUTOFFS = {
  player: { near: 2, far: 6, minShots: 5 },
  team: { near: 1, far: 3, minShots: 25 },
};

export function ZoneLegend({ mode }: { mode: "player" | "team" }) {
  const { near, far, minShots } = LEGEND_CUTOFFS[mode];
  const items: [string, string][] = [
    ["hot", `+${far} or more`],
    ["warm", `+${near} to +${far}`],
    ["neutral", `Within ${near}`],
    ["cool", `−${near} to −${far}`],
    ["cold", `−${far} or worse`],
    ["gray", `Under ${minShots} shots`],
  ];

  return (
    <div className="zone-legend">
      <span className="zone-legend-title">FG% vs D1 average, in points</span>
      <ul>
        {items.map(([bucket, label]) => (
          <li key={bucket}>
            <span
              className={bucket === "gray" ? "swatch no-data" : "swatch"}
              style={{ background: BUCKET_COLORS[bucket] }}
            />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

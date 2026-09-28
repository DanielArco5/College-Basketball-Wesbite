import {
  BUCKET_COLORS,
  HOOP,
  VIEW_H,
  VIEW_W,
  buildZoneGrid,
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

const LINE = "#6B5D4F";
const SURFACE = "#241C16";

export default function ShotChart({ stats }: { stats: ZoneStat[] }) {
  const byZone = new Map(stats.map((s) => [s.zone, s]));
  const cells = buildZoneGrid();

  const fillFor = (zone: Zone) => {
    const stat = byZone.get(zone);
    if (!stat) return BUCKET_COLORS.gray;
    return BUCKET_COLORS[stat.color_bucket] ?? BUCKET_COLORS.gray;
  };

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="court"
      role="img"
      aria-label="Shot chart by court zone"
    >
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill={SURFACE} />

      {/* Zone fills. One rect per square foot, colored by the same rule the
          database used. Adjacent cells in a zone share a color and merge
          into a solid region. */}
      <g opacity={0.82} shapeRendering="crispEdges">
        {cells.map((c, i) => (
          <rect
            key={i}
            x={c.sx}
            y={c.sy}
            width={10}
            height={10}
            fill={fillFor(c.zone)}
          />
        ))}
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

        {/* Backboard and rim */}
        <path d="M 220 280 L 280 280" strokeWidth={3} />
        <circle cx={250} cy={HOOP.sy} r={7.5} strokeWidth={2} />
      </g>
    </svg>
  );
}

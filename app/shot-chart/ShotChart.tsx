"use client";

import { useId, useState, type CSSProperties, type PointerEvent } from "react";
import {
  BASKET_Y_FT,
  COLOR_RANGE_PTS,
  CORNER_3_BREAK_FT,
  CORNER_3_INSET_FT,
  HOOP,
  LANE_DEPTH_FT,
  LANE_HALF_WIDTH_FT,
  LOW_SAMPLE_PATTERN_ID,
  LOW_SAMPLE_SHOTS,
  PX_PER_FT,
  RESTRICTED_AREA_FT,
  THREE_POINT_RADIUS_FT,
  VIEW_DEPTH_FT,
  VIEW_H,
  VIEW_W,
  ZONE_LABELS,
  chartZone,
  toSvg,
  zoneColor,
  zoneOf,
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
  attempt_share?: number;
};

type Mode = "player" | "team";

// Lines are drawn in a near-black a shade under the surface, so they read
// as gaps between zones and hold up on every fill.
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

/** Below this chart width the tooltip moves under the chart. */
const NARROW_PX = 520;

export default function ShotChart({
  stats,
  mode,
  side,
}: {
  stats: ZoneStat[];
  mode: Mode;
  side: "offense" | "defense";
}) {
  const byZone = new Map(stats.map((s) => [s.zone, s]));
  const [hover, setHover] = useState<{ zone: Zone; x: number; y: number; flip: boolean; narrow: boolean } | null>(null);
  const maskId = useId();
  const lowMaskId = useId();

  // The three spots above the break are painted as one zone, from the
  // combined row page.tsx adds (see withAboveBreak in lib/court.ts).
  const fillFor = (zone: Zone) => {
    const stat = byZone.get(chartZone(zone));
    return zoneColor(stat?.fg_pct_vs_league ?? 0, mode, side);
  };
  const isLow = (zone: Zone) =>
    (byZone.get(chartZone(zone))?.attempts ?? 0) < LOW_SAMPLE_SHOTS;

  // The pointer, in court feet, picks its zone with the same rules the
  // database used to file the shots, so the hover always matches the paint.
  const track = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * VIEW_W;
    const sy = ((e.clientY - box.top) / box.height) * VIEW_H;
    const zone = chartZone(zoneOf(VIEW_DEPTH_FT - sy / PX_PER_FT, sx / PX_PER_FT));
    const x = e.clientX - box.left;
    setHover({
      zone,
      x,
      y: e.clientY - box.top,
      flip: x > box.width / 2,
      narrow: box.width < NARROW_PX,
    });
  };

  const stat = hover ? byZone.get(hover.zone) : undefined;

  return (
    <div className="court-wrap">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="court"
        role="img"
        aria-label="Shot chart by court zone. Hover a zone for its numbers; the table lists them all."
        onPointerMove={track}
        onPointerDown={track}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
      >
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill={SURFACE} />

        <defs>
          {/* Small sample: dark stripes laid over the zone's own color. */}
          <pattern
            id={LOW_SAMPLE_PATTERN_ID}
            width={7}
            height={7}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1={0} y1={0} x2={0} y2={7} stroke="#14100D" strokeOpacity={0.6} strokeWidth={2} />
          </pattern>
          <clipPath id="zone-inside-arc">
            <circle cx={HOOP.sx} cy={HOOP.sy} r={ARC_R} />
          </clipPath>
          <clipPath id="zone-between-corners">
            <rect x={CORNER_W} y={0} width={VIEW_W - 2 * CORNER_W} height={VIEW_H} />
          </clipPath>
          {/* Zones under the small-sample floor in white, the rest black. */}
          <mask id={lowMaskId}>
            <ZoneShapes fill={(z) => (isLow(z) ? "#fff" : "#000")} />
          </mask>
          {/* The hovered zone in white, every other zone in black. */}
          {hover && (
            <mask id={maskId}>
              <ZoneShapes fill={(z) => (chartZone(z) === hover.zone ? "#fff" : "#000")} />
            </mask>
          )}
        </defs>

        <ZoneShapes fill={fillFor} />
        <rect
          width={VIEW_W}
          height={VIEW_H}
          fill={`url(#${LOW_SAMPLE_PATTERN_ID})`}
          mask={`url(#${lowMaskId})`}
          pointerEvents="none"
        />

        {hover && (
          <rect
            width={VIEW_W}
            height={VIEW_H}
            fill="#fff"
            fillOpacity={0.16}
            mask={`url(#${maskId})`}
            pointerEvents="none"
          />
        )}

        {/* Court markings, drawn over the fills so the geometry stays legible. */}
        <g fill="none" stroke={LINE} strokeWidth={2} strokeLinecap="square" pointerEvents="none">
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

          {/* Corner / above-the-break dividers, where the corner line meets
              the arc. A touch heavier than the other lines: the two zones
              meet along a short edge and read as one strip otherwise. */}
          <path
            d={`M 0 ${CORNER_TOP} H ${CORNER_W} M ${VIEW_W - CORNER_W} ${CORNER_TOP} H ${VIEW_W}`}
            strokeWidth={3}
            strokeLinecap="butt"
          />

          {/* Backboard and rim */}
          <path d="M 220 280 L 280 280" strokeWidth={3} />
          <circle cx={250} cy={HOOP.sy} r={7.5} strokeWidth={2} />
        </g>
      </svg>

      {hover && (
        <ZoneTip
          zone={hover.zone}
          stat={stat}
          side={side}
          // Beside the pointer, flipped to its left past the middle so it
          // never runs off the chart's right edge. On a phone there's no
          // room beside a finger, so it sits centered under the chart.
          style={
            hover.narrow
              ? { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }
              : {
                  top: hover.y,
                  left: hover.x,
                  transform: `translate(${hover.flip ? "calc(-100% - 14px)" : "14px"}, -50%)`,
                }
          }
        />
      )}
    </div>
  );
}

/**
 * Every zone as an exact shape, painted back to front so each layer
 * carves its zone out of the one beneath: the same precedence zoneOf()
 * checks in, reversed. Drawn three times: the colors, and the masks that
 * place the small-sample stripes and the hover highlight.
 */
function ZoneShapes({ fill }: { fill: (zone: Zone) => string }) {
  return (
    <g pointerEvents="none">
      {/* Above the break, as one zone: everything past the arc. The
          zones below carve the rest out of it. */}
      <rect width={VIEW_W} height={VIEW_H} fill={fill("above_break_3")} />

      {/* Inside the arc and between the corner lines: mid-range. */}
      <g clipPath="url(#zone-between-corners)">
        <g clipPath="url(#zone-inside-arc)">
          <rect width={VIEW_W} height={VIEW_H} fill={fill("mid_range")} />
        </g>
      </g>

      <rect
        y={CORNER_TOP}
        width={CORNER_W}
        height={VIEW_H - CORNER_TOP}
        fill={fill("corner_3_right")}
      />
      <rect
        x={VIEW_W - CORNER_W}
        y={CORNER_TOP}
        width={CORNER_W}
        height={VIEW_H - CORNER_TOP}
        fill={fill("corner_3_left")}
      />

      <rect
        x={LANE_L}
        y={LANE_TOP}
        width={LANE_R - LANE_L}
        height={VIEW_H - LANE_TOP}
        fill={fill("paint_non_ra")}
      />
      <circle cx={HOOP.sx} cy={HOOP.sy} r={RA_R} fill={fill("restricted_area")} />
    </g>
  );
}

/** The hovered zone's numbers: its FG% beside the D1 average. */
function ZoneTip({
  zone,
  stat,
  side,
  style,
}: {
  zone: Zone;
  stat: ZoneStat | undefined;
  side: "offense" | "defense";
  style: CSSProperties;
}) {
  const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
  return (
    <div className="zone-tip" style={style} role="status">
      <strong>{ZONE_LABELS[zone]}</strong>
      {!stat || stat.attempts === 0 ? (
        <span className="zone-tip-dim">No attempts</span>
      ) : (
        <>
          <span>
            {side === "defense" ? "Opponents " : ""}
            <b>{pct(stat.raw_fg_pct)}</b>{" "}
            <span className="zone-tip-dim">
              ({stat.makes}/{stat.attempts})
            </span>
          </span>
          <span className="zone-tip-dim">D1 average {pct(stat.league_fg_pct)}</span>
          <Gap diff={stat.raw_fg_pct - stat.league_fg_pct} side={side} />
          {/* The color and the table's vs D1 use the adjusted gap; say so
              when it's far enough off the raw one to look like a mismatch. */}
          {Math.abs(stat.raw_fg_pct - stat.league_fg_pct - stat.fg_pct_vs_league) >= 0.005 && (
            <span className="zone-tip-dim">
              {signed(stat.fg_pct_vs_league)} after the small-sample adjustment
            </span>
          )}
          {stat.attempts < LOW_SAMPLE_SHOTS && (
            <span className="zone-tip-dim">Small sample: under {LOW_SAMPLE_SHOTS} shots</span>
          )}
        </>
      )}
    </div>
  );
}

/** 0.048 -> "+4.8", with no "-0.0". */
function signed(diff: number) {
  const pts = Math.round(1000 * diff) / 10 || 0;
  return `${pts > 0 ? "+" : ""}${pts.toFixed(1)}`;
}

function Gap({ diff, side }: { diff: number; side: "offense" | "defense" }) {
  const pts = 100 * diff;
  const word = Math.abs(pts) < 0.05 ? "Even with" : pts > 0 ? "above" : "below";
  // Green when it's good for this team, red when it isn't.
  const good = side === "defense" ? -pts : pts;
  return (
    <span className={good > 0 ? "zone-tip-good" : good < 0 ? "zone-tip-bad" : ""}>
      {word === "Even with"
        ? "Even with D1 average"
        : `${Math.abs(pts).toFixed(1)} pts ${word} average`}
    </span>
  );
}

/** Key for the zone colors: the gradient, its ends, and the stripes.
 *  Bad on the left, good on the right, on both sides of the ball. */
export function ZoneLegend({ mode, side }: { mode: Mode; side: "offense" | "defense" }) {
  const range = COLOR_RANGE_PTS[mode];
  // Sampled from the same function as the fills (on the offense scale,
  // where low is bad), so the bar matches them.
  const steps = Array.from({ length: 21 }, (_, i) => {
    const pts = -range + (i * 2 * range) / 20;
    return `${zoneColor(pts / 100, mode)} ${(i * 100) / 20}%`;
  });
  const [worse, better] = side === "defense" ? ["+", "−"] : ["−", "+"];

  return (
    <div className="zone-legend">
      <span className="zone-legend-title">
        {side === "defense" ? "Opponents\u2019 FG%" : "FG%"} vs D1 average, in points
      </span>
      <div className="zone-scale">
        <span className="zone-scale-bar" style={{ background: `linear-gradient(90deg, ${steps.join(", ")})` }} />
        <span className="zone-scale-ticks">
          <span>
            {worse}
            {range} or worse
          </span>
          <span>Average</span>
          <span>
            {better}
            {range} or better
          </span>
        </span>
      </div>
      <span className="zone-legend-low">
        <span className="swatch low" style={{ ["--c" as string]: zoneColor(0, mode) }} />
        Under {LOW_SAMPLE_SHOTS} shots
      </span>
    </div>
  );
}

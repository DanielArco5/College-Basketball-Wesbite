/**
 * Court geometry and zone logic.
 *
 * zoneOf() is a direct port of the zone_of() function in
 * supabase/zones-and-baselines.sql. The two MUST stay in sync — the
 * database decides which zone a shot belongs to, this decides which
 * pixels get that zone's color, and if they disagree the chart lies.
 *
 * If you change one, change the other, and re-run the agreement check
 * at the bottom of that SQL file.
 */

// Court coordinates, in feet, matching what the ingest writes:
//   x = distance from the baseline, 0..47
//   y = distance across the court, 0..50
//   basket center at (5.25, 25)
export const COURT_WIDTH_FT = 50;
export const BASKET_X_FT = 5.25;
export const BASKET_Y_FT = 25;

export const THREE_POINT_RADIUS_FT = 22.1458; // 22' 1.75"
export const CORNER_3_INSET_FT = 3.34; // from each sideline
export const CORNER_3_BREAK_FT = 9.9; // where the corner line meets the arc
export const RESTRICTED_AREA_FT = 4;
export const LANE_HALF_WIDTH_FT = 6; // lane is 12 ft wide
export const LANE_DEPTH_FT = 19;
// Above-the-break threes are split into wings and top of the key at this
// angle either side of straight-on from the hoop. The arc runs ~78° each
// way before it meets the corner lines, so 26° makes three equal wedges.
export const WING_SPLIT_DEG = 26;

// How much of the half court to draw. Shots past ~32 ft are rare enough
// that including the full 47 would leave most of the chart empty.
export const VIEW_DEPTH_FT = 32;

export const PX_PER_FT = 10;
export const VIEW_W = COURT_WIDTH_FT * PX_PER_FT; // 500
export const VIEW_H = VIEW_DEPTH_FT * PX_PER_FT; // 320

/** Court feet to SVG pixels. Baseline sits at the bottom, hoop near it. */
export function toSvg(courtX: number, courtY: number) {
  return {
    sx: courtY * PX_PER_FT,
    sy: (VIEW_DEPTH_FT - courtX) * PX_PER_FT,
  };
}

export const HOOP = toSvg(BASKET_X_FT, BASKET_Y_FT);

export type Zone =
  | "restricted_area"
  | "paint_non_ra"
  | "mid_range"
  | "corner_3_left"
  | "corner_3_right"
  | "wing_3_left"
  | "top_3"
  | "wing_3_right";

export function zoneOf(x: number, y: number): Zone {
  // Corner threes first. A corner three sits closer to the rim than the
  // arc radius — that is exactly why it is the most efficient shot in
  // basketball — so checking the arc first would misfile every one of
  // them as mid-range.
  if (x <= CORNER_3_BREAK_FT && y >= COURT_WIDTH_FT - CORNER_3_INSET_FT)
    return "corner_3_left";
  if (x <= CORNER_3_BREAK_FT && y <= CORNER_3_INSET_FT) return "corner_3_right";

  const dist = Math.hypot(x - BASKET_X_FT, y - BASKET_Y_FT);

  if (dist >= THREE_POINT_RADIUS_FT) {
    const reach = Math.tan((WING_SPLIT_DEG * Math.PI) / 180) * (x - BASKET_X_FT);
    if (y - BASKET_Y_FT > reach) return "wing_3_left";
    if (BASKET_Y_FT - y > reach) return "wing_3_right";
    return "top_3";
  }
  if (dist <= RESTRICTED_AREA_FT) return "restricted_area";

  if (
    x <= LANE_DEPTH_FT &&
    y >= BASKET_Y_FT - LANE_HALF_WIDTH_FT &&
    y <= BASKET_Y_FT + LANE_HALF_WIDTH_FT
  )
    return "paint_non_ra";

  return "mid_range";
}

export const ZONE_LABELS: Record<Zone, string> = {
  restricted_area: "At the rim",
  paint_non_ra: "Paint",
  mid_range: "Mid-range",
  corner_3_left: "Left corner three",
  corner_3_right: "Right corner three",
  wing_3_left: "Left wing three",
  top_3: "Top of the key three",
  wing_3_right: "Right wing three",
};

/** Reading order for the table: close to far. */
export const ZONE_ORDER: Zone[] = [
  "restricted_area",
  "paint_non_ra",
  "mid_range",
  "corner_3_left",
  "corner_3_right",
  "wing_3_left",
  "top_3",
  "wing_3_right",
];

// ── Zone color ─────────────────────────────────────────────────────────
// A continuous scale from bad to good: red, through yellow at the D1
// average, to green, with a shade for every point between. "Good" depends
// on the side: shooting above average on offense, holding opponents below
// it on defense.
//
// Soft on purpose, in the manner of NBA.com's zone charts: all three stops
// are muted and close in lightness, so neighboring zones a few points
// apart drift in hue instead of jumping in brightness. Mixed in OKLab,
// where equal steps look equal.
export const COLOR_STOPS = {
  bad: "#A65545",
  mid: "#AE9C5C",
  good: "#5D8F5B",
};

/** Points vs D1 at which a zone reaches full color. Teams vary about half
 *  as much as players (a season of shots evens out), so their scale is
 *  tighter. Both sit past the 99th percentile, so only a true outlier
 *  reaches the end and typical gaps stay gentle. */
export const COLOR_RANGE_PTS = { player: 12, team: 7 };

/** Fewer attempts than this and the zone is striped: colored, but flagged
 *  as a small sample. */
export const LOW_SAMPLE_SHOTS = 5;

/** Fill for a zone `diff` (a fraction: 0.031 is +3.1 points) from the D1
 *  average, on the given mode's scale. On defense the diff is opponents'
 *  shooting, so above average is the bad end. */
export function zoneColor(
  diff: number,
  mode: "player" | "team",
  side: "offense" | "defense" = "offense",
) {
  const good = side === "defense" ? -diff : diff;
  const t = Math.max(-1, Math.min(1, (100 * good) / COLOR_RANGE_PTS[mode]));
  const end = t < 0 ? COLOR_STOPS.bad : COLOR_STOPS.good;
  return mix(COLOR_STOPS.mid, end, Math.abs(t));
}

function mix(a: string, b: string, t: number) {
  const [x, y] = [toOklab(a), toOklab(b)];
  return fromOklab(x.map((v, i) => v + (y[i] - v) * t) as Vec3);
}

type Vec3 = [number, number, number];

function toOklab(hex: string): Vec3 {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: Vec3) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    "#" +
    rgb
      .map((c) => {
        const v = Math.max(0, Math.min(1, c));
        const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
        return Math.round(srgb * 255).toString(16).padStart(2, "0");
      })
      .join("")
  );
}

/** SVG pattern id for the small-sample stripes, laid over a zone's color. */
export const LOW_SAMPLE_PATTERN_ID = "zone-low-sample";

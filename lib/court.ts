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
  | "mid_left"
  | "mid_center"
  | "mid_right"
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

  if (y > BASKET_Y_FT + LANE_HALF_WIDTH_FT) return "mid_left";
  if (y < BASKET_Y_FT - LANE_HALF_WIDTH_FT) return "mid_right";
  return "mid_center";
}

export const ZONE_LABELS: Record<Zone, string> = {
  restricted_area: "At the rim",
  paint_non_ra: "Paint",
  mid_left: "Mid-range, left",
  mid_center: "Mid-range, center",
  mid_right: "Mid-range, right",
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
  "mid_left",
  "mid_center",
  "mid_right",
  "corner_3_left",
  "corner_3_right",
  "wing_3_left",
  "top_3",
  "wing_3_right",
];

// Diverging scale built for the dark court: red above average, blue below,
// a dark warm stone that recedes in between. The extremes are the deepest,
// most saturated steps; the near steps are lighter and softer. Chosen in
// OKLCH and checked for color-blind separation. "gray" (too
// few attempts) is drawn as a hatch over the court, not a color, so it can't
// be read as "average"; this value is only the fallback.
export const BUCKET_COLORS: Record<string, string> = {
  hot: "#B7191C",
  warm: "#CF6968",
  neutral: "#393530",
  cool: "#5E91C0",
  cold: "#1F5DC2",
  gray: "#2B231D",
};

/** SVG pattern id for the "too few attempts" hatch, shared by chart and swatches. */
export const NO_DATA_PATTERN_ID = "zone-no-data";

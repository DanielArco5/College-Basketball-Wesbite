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
  | "above_break_3";

export function zoneOf(x: number, y: number): Zone {
  // Corner threes first. A corner three sits closer to the rim than the
  // arc radius — that is exactly why it is the most efficient shot in
  // basketball — so checking the arc first would misfile every one of
  // them as mid-range.
  if (x <= CORNER_3_BREAK_FT && y >= COURT_WIDTH_FT - CORNER_3_INSET_FT)
    return "corner_3_left";
  if (x <= CORNER_3_BREAK_FT && y <= CORNER_3_INSET_FT) return "corner_3_right";

  const dist = Math.hypot(x - BASKET_X_FT, y - BASKET_Y_FT);

  if (dist >= THREE_POINT_RADIUS_FT) return "above_break_3";
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
  above_break_3: "Above the break",
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
  "above_break_3",
];

export const BUCKET_COLORS: Record<string, string> = {
  hot: "#D62728",
  warm: "#F08A5D",
  neutral: "#9AA0A6",
  cool: "#6BA3D6",
  cold: "#1F5FA9",
  gray: "#3C4043",
};

/** One-foot cells covering the drawn half court, each tagged with its zone. */
export function buildZoneGrid() {
  const cells: { sx: number; sy: number; zone: Zone }[] = [];
  for (let x = 0; x < VIEW_DEPTH_FT; x++) {
    for (let y = 0; y < COURT_WIDTH_FT; y++) {
      // Sample the cell's center so boundaries land predictably.
      const zone = zoneOf(x + 0.5, y + 0.5);
      const { sx, sy } = toSvg(x + 1, y); // top-left corner of the cell
      cells.push({ sx, sy, zone });
    }
  }
  return cells;
}

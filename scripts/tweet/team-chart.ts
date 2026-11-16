/**
 * A team whose shot chart doesn't look like the rest of Division I.
 *
 * "Unusual" is about what kind of shots a team takes: layups and dunks,
 * two-point jumpers, or threes. The measure is the share of its shots
 * that would have to change kind to match the D1 mix. The most unusual
 * team not charted lately gets the post.
 *
 * The kinds come from the play-by-play (a layup is scored as a layup),
 * not from where the shot was plotted. Plotting is loose near the basket:
 * in a typical game a third of layups are marked outside the restricted
 * area, and for some scorers most are, so "at the rim" by location can't
 * be compared between teams. A team whose layups are mostly plotted off
 * the rim isn't charted at all; its picture would mislead.
 *
 * The image is the site's team chart: zones colored by FG% against the
 * D1 average there, on the same scale (lib/court.ts), drawn from the
 * team's own shots so it doesn't wait on the summary views.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ABOVE_BREAK,
  BASKET_Y_FT,
  COLOR_RANGE_PTS,
  CORNER_3_BREAK_FT,
  CORNER_3_INSET_FT,
  HOOP,
  LANE_DEPTH_FT,
  LANE_HALF_WIDTH_FT,
  LOW_SAMPLE_SHOTS,
  PX_PER_FT,
  RESTRICTED_AREA_FT,
  THREE_POINT_RADIUS_FT,
  VIEW_H,
  VIEW_W,
  chartZone,
  toSvg,
  zoneColor,
  zoneOf,
  type Zone,
} from "../../lib/court";
import { FG, MUTED, PANEL, RULE, W, clip, esc, frame, onDark, pct } from "./render";

/** Fewest shots for a team to be charted: about three games. */
const MIN_SHOTS = 150;
/** How many of the likeliest teams get the exact, shot-by-shot check. */
const SHORTLIST = 10;
/** A chart needs this share of the team's layups and dunks plotted in the
 *  restricted area (the D1 norm is about two thirds), and this share of
 *  its shots plotted at all. */
const MIN_RIM_PLOTTED = 0.5;
const MIN_LOCATED = 0.85;

/** What kind of shot it was, from the play-by-play. */
const KINDS = ["rim", "jumper", "three"] as const;
type Kind = (typeof KINDS)[number];

const KIND_LABEL: Record<Kind, string> = {
  rim: "Layups, dunks, tip-ins",
  jumper: "Two-point jumpers",
  three: "Threes",
};

type Tally = { attempts: number; makes: number };
type Mix = Record<Kind, number>;

type Profile = {
  teamId: number;
  shots: number;
  games: number;
  efg: number;
  /** Located shots by zone, for the chart. */
  zones: Map<Zone, Tally>;
  mix: Mix;
  /** Share of shots that would have to change kind to match D1, 0 to 1. */
  oddness: number;
  /** Share of shots with a location, and of layups plotted at the rim. */
  located: number;
  rimPlotted: number;
};

type D1 = { fg: Map<Zone, number>; zoneShare: Map<Zone, number>; mix: Mix; efg: number };

export type TeamChartPost = { text: string; svg: string; summary: string; teamId: number; slug: string };

export async function teamChartPost(
  db: SupabaseClient,
  season: number,
  opts: { skipTeams: number[]; team?: string },
): Promise<TeamChartPost | { skip: string }> {
  const d1 = await d1Baseline(db, season);
  const teams = await d1Teams(db);

  let pick: Profile | undefined;
  if (opts.team) {
    const want = opts.team.toLowerCase();
    const id = [...teams].find(([, t]) => t.school.toLowerCase() === want || t.short.toLowerCase() === want)?.[0];
    if (id == null) return { skip: `no Division I team named "${opts.team}"` };
    pick = await profile(db, season, id, d1);
    if (!pick.shots) return { skip: `${opts.team} has no shots this season` };
    if (!chartable(pick)) {
      console.warn(
        `Note: ${opts.team}'s shot locations are loose (${pct(pick.rimPlotted, 0)} of layups plotted at the rim, ` +
          `${pct(pick.located, 0)} of shots located). The scheduled job would skip this team.`,
      );
    }
  } else {
    const skip = new Set(opts.skipTeams);
    const shortlist = (await roughOddness(db, season, d1))
      .filter((c) => teams.has(c.teamId) && !skip.has(c.teamId))
      .slice(0, SHORTLIST);
    const exact = await Promise.all(shortlist.map((c) => profile(db, season, c.teamId, d1)));
    pick = exact.filter((p) => p.shots >= MIN_SHOTS && chartable(p)).sort((a, b) => b.oddness - a.oddness)[0];
    if (!pick) return { skip: `no unusual team with ${MIN_SHOTS} shots and reliable shot locations yet` };
  }

  const team = teams.get(pick.teamId)!;
  const lines = headline(team.school, pick.mix, d1.mix);
  const text = [`Shot chart: ${team.school}`, "", ...lines, "", "Zones are colored by FG% against the D1 average."].join(
    "\n",
  );

  return {
    text,
    svg: card(team, pick, d1),
    teamId: pick.teamId,
    slug: team.school.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    summary:
      `${team.school}: ${pick.shots} shots, ${pick.games} games, ${pct(pick.oddness)} of shots off the D1 mix ` +
      `(${pct(pick.rimPlotted, 0)} of layups plotted at the rim)\n` +
      KINDS.map((k) => `  ${KIND_LABEL[k].padEnd(24)} ${pct(pick.mix[k]).padStart(6)}   D1 ${pct(d1.mix[k]).padStart(6)}`).join("\n"),
  };
}

function chartable(p: Profile) {
  return p.located >= MIN_LOCATED && p.rimPlotted >= MIN_RIM_PLOTTED;
}

// ── Data ───────────────────────────────────────────────────────────────

/** D1 averages: FG% by zone, the mix of shot kinds, and eFG%. */
async function d1Baseline(db: SupabaseClient, season: number): Promise<D1> {
  const count = async (kind?: "rim" | "three_pointer") => {
    let q = db.from("shot_events").select("id", { count: "exact", head: true }).eq("season", season);
    if (kind) q = q.eq("cbbd_range", kind);
    const { count: n, error } = await q;
    if (error || n == null) throw new Error(error?.message ?? "count failed");
    return n;
  };
  // Counted over every shot in a D1 team's game, so the few shots by
  // non-D1 opponents are in here too; they move it by a fraction of a point.
  const [zones, totals, all, rim, three] = await Promise.all([
    db.from("zone_baselines").select("zone,attempts,fg_pct").eq("season", season),
    db.from("d1_season_totals").select("attempts,makes,three_makes").eq("season", season).maybeSingle(),
    count(),
    count("rim"),
    count("three_pointer"),
  ]);
  if (zones.error) throw new Error(zones.error.message);
  if (totals.error) throw new Error(totals.error.message);
  if (!zones.data?.length || !totals.data || !all) throw new Error(`No D1 averages for ${season} yet.`);
  const located = zones.data.reduce((n, z) => n + z.attempts, 0);
  return {
    fg: new Map(zones.data.map((z) => [z.zone as Zone, z.fg_pct as number])),
    zoneShare: new Map(zones.data.map((z) => [z.zone as Zone, z.attempts / located])),
    mix: { rim: rim / all, three: three / all, jumper: (all - rim - three) / all },
    efg: (totals.data.makes + 0.5 * totals.data.three_makes) / totals.data.attempts,
  };
}

async function d1Teams(db: SupabaseClient) {
  const { data, error } = await db
    .from("teams")
    .select("id,school,short_display,primary_color,color_override")
    .eq("is_d1", true);
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).map((t) => [
      t.id as number,
      {
        school: t.school as string,
        short: (t.short_display ?? t.school) as string,
        color: (t.color_override ?? t.primary_color) as string | null,
      },
    ]),
  );
}

/**
 * Every team ordered by a rough oddness, from the summary view: its split
 * of shots among the paint, mid-range and three against D1's. By location
 * rather than kind, and a refresh behind, but one quick read for all 360
 * teams. It only chooses who gets the exact check.
 */
async function roughOddness(db: SupabaseClient, season: number, d1: D1) {
  type Rough = { paint: number; mid: number; three: number };
  const area = (zone: string): keyof Rough =>
    zone === "restricted_area" || zone === "paint_non_ra" ? "paint" : zone === "mid_range" ? "mid" : "three";
  const byTeam = new Map<number, Rough>();
  const present = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("team_zone_stats")
      .select("team_id,zone,attempts")
      .eq("season", season)
      .order("team_id")
      .order("zone")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const t = byTeam.get(r.team_id) ?? { paint: 0, mid: 0, three: 0 };
      t[area(r.zone)] += r.attempts;
      byTeam.set(r.team_id, t);
      present.add(r.zone);
    }
    if ((data ?? []).length < 1000) break;
  }
  // D1's split over the zones the view has: early in a season it leaves
  // out the ones it can't fit yet (the corners).
  const seen: Rough = { paint: 0, mid: 0, three: 0 };
  for (const [zone, share] of d1.zoneShare) if (present.has(zone)) seen[area(zone)] += share;
  const d1Total = seen.paint + seen.mid + seen.three;

  return [...byTeam]
    .map(([teamId, t]) => {
      const shots = t.paint + t.mid + t.three;
      const oddness =
        0.5 *
        (["paint", "mid", "three"] as const).reduce((n, a) => n + Math.abs(t[a] / shots - seen[a] / d1Total), 0);
      return { teamId, shots, oddness };
    })
    .filter((c) => c.shots >= MIN_SHOTS * 0.8)
    .sort((a, b) => b.oddness - a.oddness);
}

/** One team's mix, zones and eFG%, counted from its shots. */
async function profile(db: SupabaseClient, season: number, teamId: number, d1: D1): Promise<Profile> {
  const zones = new Map<Zone, Tally>();
  const games = new Set<number>();
  const kinds: Mix = { rim: 0, jumper: 0, three: 0 };
  let shots = 0;
  let makes = 0;
  let threeMakes = 0;
  let located = 0;
  let rimLocated = 0;
  let rimAtRim = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("shot_events")
      .select("game_id,x,y,zone,made,score_value,cbbd_range")
      .eq("season", season)
      .eq("team_id", teamId)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const s of data ?? []) {
      const kind: Kind =
        s.score_value === 3 || s.cbbd_range === "three_pointer" ? "three" : s.cbbd_range === "rim" ? "rim" : "jumper";
      kinds[kind] += 1;
      shots += 1;
      games.add(s.game_id);
      if (s.made) makes += 1;
      if (s.made && kind === "three") threeMakes += 1;
      if (s.x == null) continue;

      // Shots from the latest import have no zone until the next refresh;
      // zoneOf() files them the way the database will.
      const zone = (s.zone ?? zoneOf(Number(s.x), Number(s.y))) as Zone;
      const t = zones.get(zone) ?? { attempts: 0, makes: 0 };
      t.attempts += 1;
      if (s.made) t.makes += 1;
      zones.set(zone, t);
      located += 1;
      if (kind === "rim") {
        rimLocated += 1;
        if (zone === "restricted_area") rimAtRim += 1;
      }
    }
    if ((data ?? []).length < 1000) break;
  }
  const mix: Mix = { rim: 0, jumper: 0, three: 0 };
  if (shots) for (const k of KINDS) mix[k] = kinds[k] / shots;
  return {
    teamId,
    shots,
    games: games.size,
    efg: shots ? (makes + 0.5 * threeMakes) / shots : 0,
    zones,
    mix,
    oddness: 0.5 * KINDS.reduce((n, k) => n + Math.abs(mix[k] - d1.mix[k]), 0),
    located: shots ? located / shots : 0,
    rimPlotted: rimLocated ? rimAtRim / rimLocated : 0,
  };
}

// ── Words ──────────────────────────────────────────────────────────────

const KIND_PHRASE: Record<Kind, string> = {
  rim: "layups, dunks or tip-ins",
  jumper: "two-point jumpers",
  three: "threes",
};

/** The two biggest departures from the D1 mix, as sentences. */
function headline(school: string, mix: Mix, d1: Mix) {
  const [first, second] = [...KINDS].sort((a, b) => Math.abs(mix[b] - d1[b]) - Math.abs(mix[a] - d1[a]));
  const p = (v: number) => pct(v, 0);
  return [
    `${p(mix[first])} of ${school}'s shots are ${KIND_PHRASE[first]}. The D1 average is ${p(d1[first])}.`,
    `${mix[second] > d1[second] ? "And" : "Just"} ${p(mix[second])} are ${KIND_PHRASE[second]} (D1: ${p(d1[second])}).`,
  ];
}

// ── Image ──────────────────────────────────────────────────────────────

const LINE = "#16110D";
const COURT_SCALE = 1.5;
const COURT_X = 56;
const COURT_Y = 138;

function card(team: { school: string; color: string | null }, p: Profile, d1: D1) {
  // The chart's six zones: above the break is one, as on the site.
  const zone = (z: Zone): Tally & { gap: number } => {
    const parts = z === "above_break_3" ? ABOVE_BREAK : [z];
    const t = parts.map((part) => ({ ...(p.zones.get(part) ?? { attempts: 0, makes: 0 }), d1: d1.fg.get(part) ?? 0 }));
    const attempts = t.reduce((n, x) => n + x.attempts, 0);
    const makes = t.reduce((n, x) => n + x.makes, 0);
    // Against the D1 rate from the same spots the team shot from.
    const expected = attempts ? t.reduce((n, x) => n + x.d1 * x.attempts, 0) / attempts : 0;
    return { attempts, makes, gap: attempts ? makes / attempts - expected : 0 };
  };
  const fill = (z: Zone) => zoneColor(zone(chartZone(z)).gap, "team");
  const low = (z: Zone) => zone(chartZone(z)).attempts < LOW_SAMPLE_SHOTS;

  const label = (z: Zone, x: number, y: number, size = 17) => {
    const s = zone(z);
    if (!s.attempts) return "";
    return `
      <text x="${x}" y="${y}" font-size="${size}" font-weight="700" fill="${LINE}" text-anchor="middle">${pct(s.makes / s.attempts, 0)}</text>
      <text x="${x}" y="${y + size * 0.8}" font-size="${size * 0.62}" font-weight="500" fill="${LINE}" text-anchor="middle">${s.makes}/${s.attempts}</text>`;
  };
  const cornerLabel = (z: Zone, x: number, turn: number) => {
    const s = zone(z);
    if (!s.attempts) return "";
    return `<text transform="translate(${x} 271) rotate(${turn})" font-size="12" font-weight="700" fill="${LINE}" text-anchor="middle">${pct(s.makes / s.attempts, 0)}  ${s.makes}/${s.attempts}</text>`;
  };

  const court = `
    <g transform="translate(${COURT_X} ${COURT_Y}) scale(${COURT_SCALE})">
      <defs>
        <pattern id="low" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#14100D" stroke-opacity="0.6" stroke-width="2"/>
        </pattern>
        <clipPath id="inside-arc"><circle cx="${HOOP.sx}" cy="${HOOP.sy}" r="${ARC_R}"/></clipPath>
        <clipPath id="between-corners"><rect x="${CORNER_W}" y="0" width="${VIEW_W - 2 * CORNER_W}" height="${VIEW_H}"/></clipPath>
        <clipPath id="court"><rect width="${VIEW_W}" height="${VIEW_H}" rx="6"/></clipPath>
        <mask id="low-zones">${zoneShapes((z) => (low(z) ? "#fff" : "#000"))}</mask>
      </defs>
      <g clip-path="url(#court)">
        ${zoneShapes(fill)}
        <rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#low)" mask="url(#low-zones)"/>
        ${COURT_LINES}
      </g>
      ${label("above_break_3", 250, 24, 16)}
      ${label("mid_range", 112, 196)}
      ${label("paint_non_ra", 250, 160)}
      <text x="250" y="251" font-size="15" font-weight="700" fill="${LINE}" text-anchor="middle">${
        zone("restricted_area").attempts ? pct(zone("restricted_area").makes / zone("restricted_area").attempts, 0) : ""
      }</text>
      ${cornerLabel("corner_3_right", 21, -90)}
      ${cornerLabel("corner_3_left", VIEW_W - 21, 90)}
    </g>`;

  // ── Right-hand panel: eFG%, then the mix of shot kinds against D1 ──
  const px = COURT_X + VIEW_W * COURT_SCALE + 32;
  const pw = W - 56 - px;
  const ph = VIEW_H * COURT_SCALE;
  const accent = onDark(team.color);
  const barMax = Math.max(...KINDS.map((k) => Math.max(p.mix[k], d1.mix[k])));
  const rowH = 84;
  const barsTop = COURT_Y + 196;
  const bars = KINDS.map((k, i) => {
    const y = barsTop + i * rowH;
    const scale = (v: number) => (v / barMax) * (pw - 48);
    return `
      <text x="${px + 24}" y="${y}" font-size="18" font-weight="500" fill="${FG}">${KIND_LABEL[k]}</text>
      <text x="${px + pw - 24}" y="${y}" font-size="21" font-weight="700" fill="${FG}" text-anchor="end">${pct(p.mix[k], 0)}</text>
      <rect x="${px + 24}" y="${y + 12}" width="${pw - 48}" height="12" rx="6" fill="${RULE}"/>
      <rect x="${px + 24}" y="${y + 12}" width="${Math.max(scale(p.mix[k]), 3)}" height="12" rx="6" fill="${accent}"/>
      <rect x="${px + 24 + scale(d1.mix[k]) - 1.5}" y="${y + 7}" width="3" height="22" rx="1.5" fill="${FG}"/>
      <text x="${px + 24}" y="${y + 46}" font-size="14" fill="${MUTED}">D1 average ${pct(d1.mix[k], 0)}</text>`;
  }).join("");
  const panel = `
    <rect x="${px}" y="${COURT_Y}" width="${pw}" height="${ph}" rx="14" fill="${PANEL}"/>
    <text x="${px + 24}" y="${COURT_Y + 32}" font-size="14" font-weight="700" letter-spacing="1.5" fill="${MUTED}">EFFECTIVE FG%</text>
    <text x="${px + 24}" y="${COURT_Y + 80}" font-size="44" font-weight="700" fill="${FG}">${pct(p.efg)}</text>
    <text x="${px + 24}" y="${COURT_Y + 106}" font-size="15" fill="${MUTED}">D1 average ${pct(d1.efg)}</text>
    <line x1="${px + 24}" x2="${px + pw - 24}" y1="${COURT_Y + 128}" y2="${COURT_Y + 128}" stroke="${RULE}"/>
    <text x="${px + 24}" y="${COURT_Y + 160}" font-size="14" font-weight="700" letter-spacing="1.5" fill="${MUTED}">SHOT MIX</text>
    ${bars}
    <rect x="${px + 24}" y="${COURT_Y + ph - 36}" width="3" height="18" rx="1.5" fill="${FG}"/>
    <text x="${px + 35}" y="${COURT_Y + ph - 22}" font-size="14" fill="${MUTED}">marks the D1 average</text>`;

  // ── Color key, under the title ──
  const range = COLOR_RANGE_PTS.team;
  const keyW = 210;
  const keyX = W - 56 - 92 - 40 - keyW;
  const stops = Array.from({ length: 11 }, (_, i) => {
    const pts = -range + (i * 2 * range) / 10;
    return `<stop offset="${i * 10}%" stop-color="${zoneColor(pts / 100, "team")}"/>`;
  }).join("");
  const key = `
    <defs><linearGradient id="scale">${stops}</linearGradient></defs>
    <text x="${keyX + keyW / 2}" y="52" font-size="14" fill="${MUTED}" text-anchor="middle">FG% vs D1 average</text>
    <rect x="${keyX}" y="62" width="${keyW}" height="12" rx="6" fill="url(#scale)"/>
    <text x="${keyX}" y="94" font-size="13" fill="${MUTED}">−${range} pts</text>
    <text x="${keyX + keyW}" y="94" font-size="13" fill="${MUTED}" text-anchor="end">+${range} pts</text>`;

  const body = `
    <text x="56" y="68" font-size="40" font-weight="700" fill="${FG}">${esc(clip(team.school, 26))}</text>
    <text x="56" y="106" font-size="21" fill="${MUTED}">2026-27 shot chart  ·  ${p.shots} shots, ${p.games} game${p.games === 1 ? "" : "s"}</text>
    ${key}
    ${court}
    ${panel}`;
  return frame(body, `Each zone shows FG% and makes/attempts. Striped: under ${LOW_SAMPLE_SHOTS} shots.`);
}

// Zone boundaries in court pixels, as in app/shot-chart/ShotChart.tsx.
const ARC_R = THREE_POINT_RADIUS_FT * PX_PER_FT;
const RA_R = RESTRICTED_AREA_FT * PX_PER_FT;
const CORNER_W = CORNER_3_INSET_FT * PX_PER_FT;
const CORNER_TOP = toSvg(CORNER_3_BREAK_FT, 0).sy;
const LANE_L = toSvg(0, BASKET_Y_FT - LANE_HALF_WIDTH_FT).sx;
const LANE_R = toSvg(0, BASKET_Y_FT + LANE_HALF_WIDTH_FT).sx;
const LANE_TOP = toSvg(LANE_DEPTH_FT, 0).sy;

/** Every zone, back to front: ZoneShapes in ShotChart.tsx, as a string. */
function zoneShapes(fill: (zone: Zone) => string) {
  return `
    <rect width="${VIEW_W}" height="${VIEW_H}" fill="${fill("above_break_3")}"/>
    <g clip-path="url(#between-corners)"><g clip-path="url(#inside-arc)">
      <rect width="${VIEW_W}" height="${VIEW_H}" fill="${fill("mid_range")}"/>
    </g></g>
    <rect y="${CORNER_TOP}" width="${CORNER_W}" height="${VIEW_H - CORNER_TOP}" fill="${fill("corner_3_right")}"/>
    <rect x="${VIEW_W - CORNER_W}" y="${CORNER_TOP}" width="${CORNER_W}" height="${VIEW_H - CORNER_TOP}" fill="${fill("corner_3_left")}"/>
    <rect x="${LANE_L}" y="${LANE_TOP}" width="${LANE_R - LANE_L}" height="${VIEW_H - LANE_TOP}" fill="${fill("paint_non_ra")}"/>
    <circle cx="${HOOP.sx}" cy="${HOOP.sy}" r="${RA_R}" fill="${fill("restricted_area")}"/>`;
}

/** CourtLines in ShotChart.tsx, as a string. */
const COURT_LINES = `
  <g fill="none" stroke="${LINE}" stroke-width="2" stroke-linecap="square">
    <rect x="1" y="1" width="${VIEW_W - 2}" height="${VIEW_H - 2}"/>
    <rect x="190" y="130" width="120" height="190"/>
    <circle cx="250" cy="130" r="60"/>
    <path d="M 210 ${HOOP.sy} A 40 40 0 0 1 290 ${HOOP.sy}"/>
    <path d="M 33.4 320 L 33.4 221"/>
    <path d="M 466.6 320 L 466.6 221"/>
    <path d="M 33.4 221 A 221.458 221.458 0 0 1 466.6 221"/>
    <path d="M 0 ${CORNER_TOP} H ${CORNER_W} M ${VIEW_W - CORNER_W} ${CORNER_TOP} H ${VIEW_W}" stroke-width="3" stroke-linecap="butt"/>
    <path d="M 220 280 L 280 280" stroke-width="3"/>
    <circle cx="250" cy="${HOOP.sy}" r="7.5"/>
  </g>`;

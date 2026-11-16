/**
 * The day's five hottest and five coldest shooters in Division I.
 *
 * Built from the play-by-play shots (shot_events), which the hourly job
 * keeps current; the box scores only load once a day. The two agree on
 * all but a line or two a night.
 *
 * Ranked by effective field goal percentage, (FGM + 0.5 x 3PM) / FGA, so
 * 6-for-10 on threes outranks 6-for-10 on layups. Free throws aren't in
 * it. Ties go to whoever took more shots.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { BG, FG, MUTED, PANEL, RULE, W, clip, esc, frame, onDark, pct } from "./render";

/** Fewest field goal attempts to make either list. */
export const MIN_SHOTS = 10;
const LIST = 5;

const HOT = "#F29830";
const COLD = "#6CB4EE";

type Line = {
  playerId: number;
  name: string;
  teamId: number;
  opponentId: number | null;
  fgm: number;
  fga: number;
  threeM: number;
  threeA: number;
  efg: number;
};

type Team = { school: string; short: string; color: string | null; isD1: boolean };

export type ShootersPost = { text: string; svg: string; summary: string };

/**
 * The post for `day` (YYYY-MM-DD, Eastern), or a reason there isn't one:
 * no games, or too few players with enough shots to fill both lists.
 */
export async function shootersPost(
  db: SupabaseClient,
  season: number,
  day: string,
): Promise<ShootersPost | { skip: string }> {
  const gameIds = await gamesOn(db, season, day);
  if (!gameIds.length) return { skip: `no games with shots on ${day}` };

  const teams = await loadTeams(db);
  const lines = (await shootingLines(db, gameIds)).filter(
    // Division I players, against Division I teams: a big night against
    // a lower-division opponent isn't the same feat.
    (l) => l.fga >= MIN_SHOTS && teams.get(l.teamId)?.isD1 && l.opponentId != null && teams.get(l.opponentId)?.isD1,
  );
  if (lines.length < 2 * LIST) {
    return { skip: `only ${lines.length} D1 players took ${MIN_SHOTS}+ shots on ${day}` };
  }

  const hot = [...lines].sort((a, b) => b.efg - a.efg || b.fga - a.fga || b.threeM - a.threeM).slice(0, LIST);
  const cold = [...lines].sort((a, b) => a.efg - b.efg || b.fga - a.fga).slice(0, LIST);

  const name = (id: number | null) => (id == null ? "" : (teams.get(id)?.short ?? ""));
  const line = (l: Line) =>
    `${l.name} (${name(l.teamId)}): ${l.fgm}-${l.fga} FG` + (l.threeA ? `, ${l.threeM}-${l.threeA} from three` : "");
  const text = [
    `${weekday(day)}'s hottest and coldest shooters in D1 (min. ${MIN_SHOTS} shots)`,
    "",
    `🔥 ${line(hot[0])}`,
    `🧊 ${line(cold[0])}`,
  ].join("\n");

  return {
    text,
    svg: card(day, hot, cold, teams, gameIds.length),
    summary: [
      `${day}: ${gameIds.length} games, ${lines.length} players with ${MIN_SHOTS}+ shots`,
      ...hot.map((l, i) => `  hot ${i + 1}  ${pct(l.efg).padStart(6)}  ${line(l)}`),
      ...cold.map((l, i) => `  cold ${i + 1} ${pct(l.efg).padStart(6)}  ${line(l)}`),
    ].join("\n"),
  };
}

// ── Data ───────────────────────────────────────────────────────────────

/** Ids of the season's games that tipped off on `day`, Eastern time. */
async function gamesOn(db: SupabaseClient, season: number, day: string) {
  // A wide UTC window around the Eastern day, then the exact test.
  const from = new Date(Date.parse(`${day}T00:00:00Z`)).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00Z`) + 36 * 3_600_000).toISOString();
  const { data, error } = await db
    .from("games")
    .select("id,start_date")
    .eq("season", season)
    .eq("shots_ingested", true)
    .gte("start_date", from)
    .lt("start_date", to);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((g) => easternDay(new Date(g.start_date)) === day).map((g) => g.id as number);
}

async function shootingLines(db: SupabaseClient, gameIds: number[]) {
  const byPlayer = new Map<number, Line>();
  // PostgREST returns 1,000 rows a request; a full Saturday is ~15,000.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("shot_events")
      .select("player_id,player_name,team_id,opponent_id,made,score_value,cbbd_range")
      .in("game_id", gameIds)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const s of data ?? []) {
      if (s.player_id == null || s.team_id == null) continue;
      const l =
        byPlayer.get(s.player_id) ??
        ({
          playerId: s.player_id,
          name: s.player_name ?? "",
          teamId: s.team_id,
          opponentId: s.opponent_id,
          fgm: 0,
          fga: 0,
          threeM: 0,
          threeA: 0,
          efg: 0,
        } satisfies Line);
      const three = s.score_value === 3 || s.cbbd_range === "three_pointer";
      l.fga += 1;
      if (s.made) l.fgm += 1;
      if (three) l.threeA += 1;
      if (three && s.made) l.threeM += 1;
      byPlayer.set(s.player_id, l);
    }
    if ((data ?? []).length < 1000) break;
  }
  for (const l of byPlayer.values()) l.efg = (l.fgm + 0.5 * l.threeM) / l.fga;
  return [...byPlayer.values()].filter((l) => l.name);
}

export async function loadTeams(db: SupabaseClient) {
  const { data, error } = await db
    .from("teams")
    .select("id,school,short_display,primary_color,color_override,is_d1");
  if (error) throw new Error(error.message);
  return new Map<number, Team>(
    (data ?? []).map((t) => [
      t.id as number,
      {
        school: t.school,
        short: t.short_display ?? t.school,
        color: t.color_override ?? t.primary_color,
        isD1: !!t.is_d1,
      },
    ]),
  );
}

// ── Image ──────────────────────────────────────────────────────────────

function card(day: string, hot: Line[], cold: Line[], teams: Map<number, Team>, games: number) {
  const colW = (W - 56 * 2 - 32) / 2;
  const top = 138;
  const rowH = 84;

  const column = (x: number, title: string, accent: string, lines: Line[]) => {
    const rows = lines
      .map((l, i) => {
        const y = top + 52 + i * rowH;
        const team = teams.get(l.teamId);
        const opp = l.opponentId == null ? undefined : teams.get(l.opponentId);
        const where = [team?.short, opp ? `vs ${opp.short}` : ""].filter(Boolean).join("  ·  ");
        const split = `${l.fgm}-${l.fga} FG` + (l.threeA ? `  ·  ${l.threeM}-${l.threeA} 3PT` : "");
        return `
        ${i ? `<line x1="${x + 20}" x2="${x + colW - 20}" y1="${y}" y2="${y}" stroke="${RULE}"/>` : ""}
        <text x="${x + 24}" y="${y + 50}" font-size="22" font-weight="500" fill="${MUTED}">${i + 1}</text>
        <rect x="${x + 52}" y="${y + 18}" width="6" height="${rowH - 36}" rx="3" fill="${onDark(team?.color)}"/>
        <text x="${x + 74}" y="${y + 39}" font-size="25" font-weight="700" fill="${FG}">${esc(clip(l.name, 21))}</text>
        <text x="${x + 74}" y="${y + 66}" font-size="17" fill="${MUTED}">${esc(clip(where, 34))}</text>
        <text x="${x + colW - 24}" y="${y + 39}" font-size="25" font-weight="700" fill="${accent}" text-anchor="end">${pct(l.efg, 0)}</text>
        <text x="${x + colW - 24}" y="${y + 66}" font-size="17" fill="${MUTED}" text-anchor="end">${esc(split)}</text>`;
      })
      .join("");
    return `
      <rect x="${x}" y="${top}" width="${colW}" height="${52 + LIST * rowH}" rx="14" fill="${PANEL}"/>
      <rect x="${x}" y="${top}" width="${colW}" height="52" rx="14" fill="${accent}"/>
      <rect x="${x}" y="${top + 30}" width="${colW}" height="22" fill="${accent}"/>
      <text x="${x + 24}" y="${top + 35}" font-size="22" font-weight="700" letter-spacing="2" fill="${BG}">${title}</text>
      <text x="${x + colW - 24}" y="${top + 34}" font-size="16" font-weight="700" letter-spacing="1" fill="${BG}" text-anchor="end">eFG%</text>
      ${rows}`;
  };

  const body = `
    <text x="56" y="68" font-size="40" font-weight="700" fill="${FG}">Hot and cold shooters</text>
    <text x="56" y="106" font-size="21" fill="${MUTED}">${esc(longDate(day))}  ·  ${games} games  ·  minimum ${MIN_SHOTS} shots</text>
    ${column(56, "HOTTEST", HOT, hot)}
    ${column(56 + colW + 32, "COLDEST", COLD, cold)}`;
  return frame(body, "eFG% counts a made three as 1.5 makes. Field goals only, Division I opponents only.");
}

// ── Dates ──────────────────────────────────────────────────────────────

export function easternDay(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** "Saturday" for a YYYY-MM-DD. */
function weekday(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

/** "Saturday, November 15" for a YYYY-MM-DD. */
function longDate(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Pulls everything the site needs out of Supabase and writes it to
 * local JSON. Run once a night, before `next build`.
 *
 *   npx tsx scripts/export-data.ts
 *
 * WHY THIS EXISTS: a static build of ~5,000 pages must not make ~5,000
 * database queries. This makes about a dozen bulk queries instead, and
 * the build then reads local files and never touches the network. It
 * also means the site can be rebuilt when Supabase is paused, asleep,
 * or out of credits, as long as the JSON from the last run is there.
 *
 * Output:
 *   data/meta.json              seasons, counts, generated-at
 *   data/teams.json             every D1 team
 *   data/players.json           picker list, 20+ attempts
 *   data/wire.json              Live Wire entries
 *   data/ratings.json           team ratings, all three orderings
 *   data/zones/player-<id>.json zone stats per player
 *   data/zones/team-<id>.json   offensive + defensive zone stats
 *   public/data/shots/*.json    shot locations, served to the browser
 *
 * The zones/ files are read at build time. The public/data/ files are
 * copied into the deploy as-is and fetched by the browser on demand.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SEASON = Number(process.env.EXPORT_SEASON ?? 2026);

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });

const OUT = "data";
const PUB = "public/data";

/**
 * PostgREST caps a response at 1,000 rows by default. Anything that can
 * exceed that has to be paged, or you silently export a truncated site.
 * This is the single most likely way for this script to be quietly
 * wrong, so every bulk read goes through here.
 */
async function fetchAll<T>(
  table: string,
  columns: string,
  apply: (q: any) => any = (q) => q,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await apply(
      db.from(table).select(columns).range(from, from + pageSize - 1)
    );
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

function write(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value));
}

async function main() {
  const started = Date.now();

  // Clear and recreate, so a team or player that disappears upstream
  // doesn't leave a stale page behind in the next build.
  rmSync(OUT, { recursive: true, force: true });
  rmSync(PUB, { recursive: true, force: true });
  mkdirSync(`${OUT}/zones`, { recursive: true });
  mkdirSync(`${PUB}/shots`, { recursive: true });

  // ── Teams ────────────────────────────────────────────────────────
  const teams = await fetchAll<any>(
    "teams",
    "id, school, mascot, conference, primary_color, alt_color, color_override, logo_url",
    (q) => q.eq("is_d1", true).order("school")
  );
  write(`${OUT}/teams.json`, teams);
  const teamName = new Map(teams.map((t) => [t.id, t.school]));
  console.log(`teams: ${teams.length}`);

  // ── Players for the picker ───────────────────────────────────────
  const players = await fetchAll<any>(
    "player_season_totals",
    "player_id, player_name, team_id, attempts, makes",
    (q) => q.eq("season", SEASON).gte("attempts", 20).order("player_name")
  );
  write(
    `${OUT}/players.json`,
    players.map((p) => ({
      id: p.player_id,
      name: p.player_name,
      team: teamName.get(p.team_id) ?? "",
      teamId: p.team_id,
      att: p.attempts,
    }))
  );
  console.log(`players: ${players.length}`);

  // ── Live Wire ────────────────────────────────────────────────────
  const { data: wire } = await db
    .from("live_wire_entries")
    .select("id, kind, headline, url, published_at")
    .eq("is_live", true)
    .order("published_at", { ascending: false })
    .limit(20);
  write(`${OUT}/wire.json`, wire ?? []);
  console.log(`wire: ${(wire ?? []).length}`);

  // ── Team ratings ─────────────────────────────────────────────────
  const ratings = await fetchAll<any>(
    "team_ratings",
    "team_id, school, conference, adj_off, adj_def, net, games, rk, off_rk, def_rk",
    (q) => q.eq("season", SEASON).order("rk")
  );
  write(`${OUT}/ratings.json`, ratings);
  console.log(`ratings: ${ratings.length}`);

  // ── Zone stats, bulk then grouped ────────────────────────────────
  // One query for every player's zones, then split in memory. Doing it
  // per player would be ~4,850 round trips, which is the behaviour this
  // whole exercise exists to eliminate.
  const playerZones = await fetchAll<any>(
    "player_zone_stats",
    "*",
    (q) => q.eq("season", SEASON)
  );
  const byPlayer = new Map<number, any[]>();
  for (const z of playerZones) {
    const list = byPlayer.get(z.player_id) ?? [];
    list.push(z);
    byPlayer.set(z.player_id, list);
  }
  for (const [id, zones] of byPlayer) {
    write(`${OUT}/zones/player-${id}.json`, zones);
  }
  console.log(`player zones: ${playerZones.length} rows, ${byPlayer.size} players`);

  const teamZones = await fetchAll<any>("team_zone_stats", "*", (q) =>
    q.eq("season", SEASON)
  );
  const teamDef = await fetchAll<any>("team_defense_zone_stats", "*", (q) =>
    q.eq("season", SEASON)
  );
  const defByTeam = new Map<number, any[]>();
  for (const z of teamDef) {
    const list = defByTeam.get(z.team_id) ?? [];
    list.push(z);
    defByTeam.set(z.team_id, list);
  }
  const offByTeam = new Map<number, any[]>();
  for (const z of teamZones) {
    const list = offByTeam.get(z.team_id) ?? [];
    list.push(z);
    offByTeam.set(z.team_id, list);
  }
  for (const t of teams) {
    write(`${OUT}/zones/team-${t.id}.json`, {
      offense: offByTeam.get(t.id) ?? [],
      defense: defByTeam.get(t.id) ?? [],
    });
  }
  console.log(`team zones: ${teamZones.length} off, ${teamDef.length} def`);

  // ── Shot locations ───────────────────────────────────────────────
  // The big one. Streamed in pages and written per player as flat
  // triples: [x, y, made]. Rounding to one decimal is well inside the
  // accuracy of courtside-recorded coordinates, and it roughly thirds
  // the file size against an array of objects.
  //
  // Only players above the picker threshold get a file — nobody can
  // navigate to the others.
  const wanted = new Set(players.map((p) => p.player_id));
  const shotsByPlayer = new Map<number, number[][]>();
  const shotsByTeam = new Map<number, number[][]>();

  const PAGE = 10000;
  let total = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("shot_events")
      .select("player_id, team_id, x, y, made")
      .eq("season", SEASON)
      .not("zone", "is", null)
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`shot_events: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const s of data) {
      const triple = [
        Math.round(s.x * 10) / 10,
        Math.round(s.y * 10) / 10,
        s.made ? 1 : 0,
      ];
      if (s.player_id && wanted.has(s.player_id)) {
        const list = shotsByPlayer.get(s.player_id) ?? [];
        list.push(triple);
        shotsByPlayer.set(s.player_id, list);
      }
      if (s.team_id) {
        const list = shotsByTeam.get(s.team_id) ?? [];
        list.push(triple);
        shotsByTeam.set(s.team_id, list);
      }
    }

    total += data.length;
    if (total % 100000 < PAGE) console.log(`  shots: ${total}...`);
    if (data.length < PAGE) break;
  }

  for (const [id, shots] of shotsByPlayer) {
    write(`${PUB}/shots/player-${id}.json`, shots);
  }
  // Teams take thousands of shots a season; the chart can't usefully
  // draw more than a few thousand dots, so cap it rather than ship a
  // megabyte nobody can read.
  for (const [id, shots] of shotsByTeam) {
    write(`${PUB}/shots/team-${id}.json`, shots.slice(0, 4000));
  }
  console.log(
    `shots: ${total} rows → ${shotsByPlayer.size} player files, ${shotsByTeam.size} team files`
  );

  // ── Meta ─────────────────────────────────────────────────────────
  const { data: counts } = await db
    .from("site_counts")
    .select("*")
    .eq("season", SEASON)
    .maybeSingle();

  write(`${OUT}/meta.json`, {
    season: SEASON,
    generatedAt: new Date().toISOString(),
    counts: counts ?? null,
    teams: teams.length,
    players: players.length,
  });

  console.log(
    `\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `now run \`next build\`, which reads these files and never calls Supabase.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import Link from "next/link";
import { createServerClient } from "@/lib/supabase-server";
import {
  ABOVE_BREAK,
  LOW_SAMPLE_SHOTS,
  ZONE_LABELS,
  ZONE_ORDER,
  gapOf,
  withAboveBreak,
  zoneColor,
  type Zone,
} from "@/lib/court";
import ShotChart, { ZoneLegend, type ZoneStat } from "./ShotChart";
import ShotMix, { type LeagueTotals, type SeasonTotals } from "./ShotMix";
import EntityPicker, { type PickerItem } from "./EntityPicker";
import Roster, { type RosterPlayer, type RosterSeason } from "./Roster";
import PlayerStats, { type BoxRow } from "./PlayerStats";
import GameChart, { type GameShot } from "./GameChart";
import GamePicker from "./GamePicker";
import { BoxScore, GameLog, type GameMeta, type LogRow } from "./GameLog";
import { conferenceOf, membersOf } from "@/lib/conferences";
import { apRankOf } from "@/lib/ap";
import "./shot-chart.css";

/**
 * Seasons the chart can show, newest first, named by the year they end
 * (2027 is 2026-27). The live season fills in as scripts/update-shots.ts
 * imports games; a finished season never changes.
 */
const SEASONS = [2027, 2026];
const LIVE_SEASON = 2027;
const LIVE_SEASON_START = "November 1";
const LIVE_SEASON_NOTE_EARLY = "charts open once every zone has enough shots";
const LOG_COLUMNS =
  "game_id, player_id, team_id, player_name, start_date, starter, minutes, points, oreb, rebounds, assists, steals, blocks, turnovers, fouls, fgm, fga, three_m, three_a, ftm, fta";
const TOTALS_COLUMNS =
  "attempts, makes, three_attempts, three_makes, untracked_attempts, jumper_attempts, jumper_makes";
/** Shots a player needs to be listed. A full season clears 20 easily;
 *  early in a live season that floor would hide almost everyone. */
const MIN_SEASON_ATTEMPTS = 20;
const MIN_LIVE_ATTEMPTS = 5;

function seasonLabel(season: number) {
  return `${season - 1}–${String(season).slice(2)}`;
}

// Supabase returns at most 1,000 rows per request, whatever .limit() asks
// for, so anything that can exceed that is read in pages.
const PAGE_SIZE = 1000;

async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

// The live season changes once a day at most, when new games are imported.
export const revalidate = 3600;

export const metadata = { title: "Shot charts" };

type TeamRow = {
  id: number;
  school: string;
  conference: string | null;
  primary_color: string | null;
  color_override: string | null;
};

export default async function ShotChartPage({
  searchParams,
}: {
  searchParams: Promise<{
    player?: string;
    team?: string;
    side?: string;
    season?: string;
    conference?: string;
    game?: string;
  }>;
}) {
  const params = await searchParams;
  const mode: "player" | "team" = params.team ? "team" : "player";
  // Defense is a team concept — a player has no defensive shot chart, so
  // the toggle is hidden in player mode and the param ignored there.
  const side: "offense" | "defense" =
    mode === "team" && params.side === "defense" ? "defense" : "offense";
  const db = createServerClient();

  // The stats views join each season's priors, which need real volume in
  // every zone, so they stay empty for the first weeks of a season. A
  // season is "fitted" once they're filled. The live season opens with
  // its first game all the same: until it's fitted, its charts are
  // counted straight from the shots (shotZoneStats) against the last
  // fitted season's D1 averages. The page opens on the newest season
  // with any shots, so the live season from its first game.
  const [{ data: seasonRows }, { data: playerPriors }, { data: teamPriors }] = await Promise.all([
    db.from("d1_season_totals").select("season"),
    db.from("zone_priors").select("season, zone"),
    db.from("team_zone_priors").select("season, zone"),
  ]);
  const zones = new Set((playerPriors ?? []).map((p) => p.zone)).size;
  const ready = (s: number, rows: { season: number }[] | null) =>
    (rows ?? []).filter((r) => r.season === s).length >= zones;
  const hasShots = (s: number) => (seasonRows ?? []).some((r) => r.season === s);
  const fitted = SEASONS.filter(
    (s) => hasShots(s) && ready(s, playerPriors) && ready(s, teamPriors),
  );
  const available = SEASONS.filter(
    (s) => fitted.includes(s) || (s === LIVE_SEASON && hasShots(s)),
  );
  const requested = Number(params.season);
  const season = available.includes(requested)
    ? requested
    : (available[0] ?? SEASONS.at(-1)!);
  const young = !fitted.includes(season);
  /** Whose D1 averages the page compares against. */
  const baseSeason = young ? (fitted[0] ?? season) : season;
  const minAttempts = season === LIVE_SEASON ? MIN_LIVE_ATTEMPTS : MIN_SEASON_ATTEMPTS;

  const { data: teamRows, error: teamErr } = await db
    .from("teams")
    .select("id, school, conference, primary_color, color_override")
    .eq("is_d1", true)
    .order("school");

  if (teamErr) return <Failure message={teamErr.message} />;

  const teams = (teamRows ?? []) as TeamRow[];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // A conference's member list. Both seasons are always open here: the
  // alignment is known before a game is played.
  if (params.conference) {
    const confSeason = SEASONS.includes(requested) ? requested : LIVE_SEASON;
    return (
      <ConferenceView
        conference={params.conference}
        season={confSeason}
        teams={teams}
        chartSeason={(s) => (available.includes(s) ? s : season)}
      />
    );
  }

  let items: PickerItem[] = [];
  let selectedId: number;
  let playerTeam: { player_id: number; player_name: string; team_id: number } | undefined;

  if (mode === "team") {
    items = teams.map((t) => ({
      id: t.id,
      name: t.school,
      detail: conferenceOf(t.id, season, t.conference) ?? "",
    }));
    selectedId = Number(params.team) || teams[0]?.id;
  } else {
    // Sorted by id as well as name so pages don't shuffle players who
    // share a name across the page boundary.
    const { data: candidates, error } = await fetchAll<{
      player_id: number;
      player_name: string;
      team_id: number;
      attempts: number;
    }>((from, to) =>
      db
        .from("player_season_totals")
        .select("player_id, player_name, team_id, attempts")
        .eq("season", season)
        .gte("attempts", minAttempts)
        .order("player_name")
        .order("player_id")
        .range(from, to),
    );

    if (error) return <Failure message={error} />;

    // Division I players only. Players on non-D1 opponents have shots in
    // the database (they make up D1 teams' shots allowed), but no chart.
    const d1 = candidates.filter((row) => teamById.has(row.team_id));
    items = d1.map((row) => ({
      id: row.player_id,
      name: row.player_name,
      detail: teamById.get(row.team_id)!.school,
    }));
    selectedId = Number(params.player) || items[0]?.id;
    playerTeam = d1.find((c) => c.player_id === selectedId);

    // Roster links reach players under the picker's shot floor too; look
    // them up directly so the page still knows their name and team.
    if (!playerTeam && selectedId) {
      const { data } = await db
        .from("player_season_totals")
        .select("player_id, player_name, team_id")
        .eq("season", season)
        .eq("player_id", selectedId)
        .maybeSingle();
      if (data && teamById.has(data.team_id)) playerTeam = data;
    }
    // A non-D1 player's link (an old bookmark): open the list's first player.
    if (!playerTeam && candidates.some((c) => c.player_id === selectedId)) {
      selectedId = items[0]?.id;
      playerTeam = d1.find((c) => c.player_id === selectedId);
    }
  }

  // Box scores game by game. Before supabase/game-logs.sql the table is
  // missing; the read fails quietly and the game log just doesn't show.
  const logRows = selectedId
    ? (
        await fetchAll<LogRow>((from, to) =>
          db
            .from("player_game_stats")
            .select(LOG_COLUMNS)
            .eq("season", season)
            .eq(mode === "player" ? "player_id" : "team_id", selectedId)
            .order("game_id")
            .order("player_id")
            .range(from, to),
        )
      ).data
    : [];

  // The entity's games this season, for the picker and the game log; and
  // one game's shots and box score when a game is picked.
  const games = await loadGames(
    db,
    mode,
    selectedId,
    season,
    mode === "team" ? selectedId : playerTeam?.team_id,
    teamById,
    logRows.map((r) => r.game_id),
  );
  const game = games.find((g) => g.id === Number(params.game)) ?? null;
  const gameBox = game
    ? (
        await fetchAll<LogRow>((from, to) =>
          db
            .from("player_game_stats")
            .select(LOG_COLUMNS)
            .eq("game_id", game.id)
            .order("player_id")
            .range(from, to),
        )
      ).data
    : [];
  const gameShots = game
    ? await fetchAll<GameShot>((from, to) =>
        db
          .from("shot_events")
          .select("id, x, y, made, score_value, play_type, player_name, period, clock, assisted, dist_ft, zone")
          .eq("game_id", game.id)
          .eq(mode === "player" ? "player_id" : side === "defense" ? "opponent_id" : "team_id", selectedId)
          .order("period")
          .order("seconds_remaining", { ascending: false })
          .range(from, to),
      )
    : { data: [] as GameShot[], error: null };
  if (gameShots.error) return <Failure message={gameShots.error} />;

  const { data: statRows, error: statErr } = young
    ? await shotZoneStats(
        db,
        mode === "player" ? "player_id" : side === "defense" ? "opponent_id" : "team_id",
        selectedId,
        season,
        baseSeason,
      )
    : mode === "team"
      ? await db
          .from(
            side === "defense" ? "team_defense_zone_stats" : "team_zone_stats",
          )
          .select("*")
          .eq("season", season)
          .eq("team_id", selectedId)
      : await db
          .from("player_zone_stats")
          .select("*")
          .eq("season", season)
          .eq("player_id", selectedId);

  if (statErr) return <Failure message={statErr.message} />;
  const stats = withAboveBreak((statRows ?? []) as ZoneStat[]);

  // Season totals count every field goal, including those from games
  // without location tracking, which the zone rows above can't hold.
  const totalsQuery =
    mode === "team"
      ? db
          .from(
            side === "defense"
              ? "team_defense_season_totals"
              : "team_season_totals",
          )
          .select(TOTALS_COLUMNS)
          .eq("season", season)
          .eq("team_id", selectedId)
      : db
          .from("player_season_totals")
          .select(TOTALS_COLUMNS)
          .eq("season", season)
          .eq("player_id", selectedId);

  const { data: totalsRow, error: totalsErr } = await totalsQuery.maybeSingle();
  if (totalsErr) return <Failure message={totalsErr.message} />;

  // Division I as a whole, for the averages beside each figure.
  const { data: league, error: leagueErr } = await db
    .from("d1_season_totals")
    .select("attempts, makes, three_attempts, three_makes")
    .eq("season", baseSeason)
    .maybeSingle<LeagueTotals>();
  if (leagueErr) return <Failure message={leagueErr.message} />;
  const totals: SeasonTotals = totalsRow ?? {
    attempts: 0,
    makes: 0,
    three_attempts: 0,
    three_makes: 0,
    untracked_attempts: 0,
    jumper_attempts: 0,
    jumper_makes: 0,
  };

  let heading = "";
  // Under the name: the conference on a team's page, the team on a
  // player's, each linking to its own page.
  let subheading: { label: string; href: string } | null = null;
  let accent = "#6B5D4F";

  if (mode === "team") {
    const t = teamById.get(selectedId);
    heading = t?.school ?? "Team";
    const conf = t ? conferenceOf(t.id, season, t.conference) : null;
    if (conf) subheading = { label: conf, href: conferenceHref(conf, season) };
    accent = t?.color_override ?? t?.primary_color ?? accent;
  } else {
    heading = playerTeam?.player_name ?? "Shot chart";
    const team = playerTeam ? teamById.get(playerTeam.team_id) : undefined;
    if (team) subheading = { label: team.school, href: `/shot-chart?team=${team.id}&season=${season}` };
    accent = team?.color_override ?? team?.primary_color ?? accent;
  }

  const [rosters, ap, box] = await Promise.all([
    mode === "team" ? loadRosters(db, selectedId, teamById) : Promise.resolve([]),
    mode === "team" ? apRankOf(selectedId, season) : Promise.resolve(null),
    // Box-score stats. Before supabase/player-box-stats.sql the table is
    // missing; the read fails quietly and the panel just doesn't show.
    mode === "player"
      ? db
          .from("player_box_seasons")
          .select("*")
          .eq("season", season)
          .eq("player_id", selectedId)
          .then(({ data }) => (data ?? []) as BoxRow[])
      : Promise.resolve([] as BoxRow[]),
  ]);

  const { attempts, makes } = totals;

  // Seasons this player has shots in. The season toggle keeps the player
  // only where he has a chart; elsewhere it opens that season's player list.
  const playerSeasons = new Set<number>();
  if (mode === "player" && selectedId) {
    const { data } = await db
      .from("player_season_totals")
      .select("season")
      .eq("player_id", selectedId)
      .in("season", SEASONS);
    for (const r of data ?? []) playerSeasons.add(r.season);
  }

  // A picked game's box scores: the page's own team first, then the
  // opponent (shots-allowed pages too, so both are always there).
  const ownTeam = mode === "team" ? selectedId : playerTeam?.team_id;
  const boxTeams = [...new Set(gameBox.map((r) => r.team_id))]
    .sort((a, b) => Number(b === ownTeam) - Number(a === ownTeam))
    .map((id) => ({
      id,
      name: teamById.get(id)?.school ?? (id === ownTeam ? heading : (game?.opponent ?? "Opponent")),
    }));

  return (
    <main
      className="wrap"
      style={{
        ["--accent" as string]: accent,
        ["--accent-ink" as string]: inkOn(accent),
      }}
    >
      <header className="masthead">
        <span className="accent-rule" />
        <h1>{heading}</h1>
        <p className="sub">
          {subheading && (
            <>
              <Link href={subheading.href} className="sub-link">
                {subheading.label}
              </Link>
              {" · "}
            </>
          )}
          {ap && (
            <>
              <span className="ap-badge">
                AP No. {ap.rank}
                {ap.label === "Final" ? " final" : ""}
              </span>
              {" · "}
            </>
          )}
          {game ? (
            <>
              {game.label} · {gameShots.data.length} field goal attempts
            </>
          ) : (
            <>
              {seasonLabel(season)}
              {season === LIVE_SEASON ? " so far" : ""} ·{" "}
              {attempts.toLocaleString()} field goal attempts ·{" "}
              {attempts ? ((100 * makes) / attempts).toFixed(1) : "0"}%
            </>
          )}
        </p>
        <nav className="season-toggle" aria-label="Season">
          {SEASONS.map((s) => {
            const label = `${seasonLabel(s)}${s === LIVE_SEASON ? " · live" : ""}`;
            if (!available.includes(s)) {
              return (
                <span key={s} className="is-pending" aria-disabled="true">
                  {label}
                  <span className="season-note">
                    {hasShots(s) ? LIVE_SEASON_NOTE_EARLY : `starts ${LIVE_SEASON_START}`}
                  </span>
                </span>
              );
            }
            const subject =
              mode === "team"
                ? `team=${selectedId}&`
                : playerSeasons.has(s)
                  ? `player=${selectedId}&`
                  : "";
            return (
              <Link
                key={s}
                href={`/shot-chart?${subject}season=${s}`}
                className={s === season ? "on" : ""}
                aria-current={s === season ? "page" : undefined}
                scroll={false}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <EntityPicker mode={mode} items={items} selectedName={heading} season={season} />
        {mode === "team" && (
          <nav className="side-toggle">
            <Link
              href={`/shot-chart?team=${selectedId}&side=offense&season=${season}${game ? `&game=${game.id}` : ""}`}
              className={side === "offense" ? "on" : ""}
              scroll={false}
            >
              Shots taken
            </Link>
            <Link
              href={`/shot-chart?team=${selectedId}&side=defense&season=${season}${game ? `&game=${game.id}` : ""}`}
              className={side === "defense" ? "on" : ""}
              scroll={false}
            >
              Shots allowed
            </Link>
          </nav>
        )}
        <GamePicker
          games={games.map((g) => ({ id: g.id, label: g.label }))}
          selected={game?.id ?? null}
          base={`/shot-chart?${mode === "team" ? `team=${selectedId}` : `player=${selectedId}`}&season=${season}${
            side === "defense" ? "&side=defense" : ""
          }`}
        />
      </header>

      {mode === "player" && !game && <PlayerStats rows={box} seasonLabel={seasonLabel(season)} />}

      {game ? (
        <GameView shots={gameShots.data} mode={mode} side={side} hasBox={gameBox.length > 0} />
      ) : stats.length === 0 ? (
        <p className="empty-state">
          No tracked shots for this {mode} in {seasonLabel(season)}
          {season === LIVE_SEASON ? " yet" : ""}. Some games have no shot tracking at all,
          which is most common in low-major matchups.
        </p>
      ) : (
        <div className="layout">
          <div className="chart-col">
            <figure className="chart">
              <ShotChart stats={stats} mode={mode} side={side} />
              <ZoneLegend mode={mode} side={side} />
              <figcaption>
                {side === "defense" ? (
                  <>
                    Color compares how opponents shot against this team to the
                    Division I average in each zone.
                  </>
                ) : (
                  <>
                    Color compares{" "}
                    {mode === "team" ? "this team" : "this player"}&rsquo;s FG%
                    to the Division I average in each zone.
                  </>
                )}
              </figcaption>
              {/* Green is good on both tabs, so on defense it means low
                  numbers. Worth one line, since that's backwards from offense. */}
              {side === "defense" && (
                <p className="color-note">
                  <strong>Heads up:</strong> <span className="is-good">green is good</span>{" "}
                  here too: opponents shoot below average there.{" "}
                  <span className="is-bad">Red</span> means they score more than usual.
                </p>
              )}
            </figure>

            <ShotMix totals={totals} league={league} />
          </div>

          <section className="breakdown">
            <table>
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Shots</th>
                  {mode === "team" && <th>Share</th>}
                  <th>FG%</th>
                  <th>vs D1</th>
                </tr>
              </thead>
              <tbody>
                {ZONE_ORDER.map((zone: Zone) => {
                  const s = stats.find((r) => r.zone === zone);
                  // The spots the chart folds into "above the break" sit
                  // indented under that row.
                  const sub = ABOVE_BREAK.includes(zone) ? " sub" : "";
                  if (!s) {
                    return (
                      <tr key={zone} className={`empty${sub}`}>
                        <td>{ZONE_LABELS[zone]}</td>
                        <td colSpan={mode === "team" ? 4 : 3}>No attempts</td>
                      </tr>
                    );
                  }
                  // Rounded first, so a hair under zero reads 0.0, not -0.0.
                  const diff = Math.round(1000 * gapOf(s)) / 10 || 0;
                  return (
                    <tr key={zone} className={sub.trim() || undefined}>
                      <td>
                        <span
                          className={s.attempts < LOW_SAMPLE_SHOTS ? "swatch low" : "swatch"}
                          style={{ ["--c" as string]: zoneColor(gapOf(s), mode, side) }}
                        />
                        {ZONE_LABELS[zone]}
                      </td>
                      <td className="num">
                        {s.makes}/{s.attempts}
                      </td>
                      {mode === "team" && (
                        <td className="num">
                          {((s.attempt_share ?? 0) * 100).toFixed(1)}%
                        </td>
                      )}
                      <td className="num">{(100 * s.raw_fg_pct).toFixed(1)}</td>
                      <td className="num">
                        {`${diff > 0 ? "+" : ""}${diff.toFixed(1)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="accuracy-note">
              Colors and vs D1 compare each zone&rsquo;s FG% straight to the
              Division I average there, in percentage points. Zones with
              fewer than {LOW_SAMPLE_SHOTS} attempts are striped: the color is
              the real FG%, but it rests on few shots, so a hot or cold streak
              can swing it. Hover a zone on the chart for its numbers.
              {young &&
                ` Early in ${seasonLabel(season)}, D1 averages are ${seasonLabel(baseSeason)}'s until the new season has enough shots.`}
              {side === "defense" &&
                " Shots allowed are a rough read on defense: they reflect who a team played as much as how it defended, and opponent three-point shooting is largely luck."}
            </p>
          </section>
        </div>
      )}

      {game &&
        boxTeams.map((t) => (
          <BoxScore
            key={t.id}
            rows={gameBox.filter((r) => r.team_id === t.id)}
            title={`${t.name} box score`}
            season={season}
            linkPlayers={teamById.has(t.id)}
          />
        ))}
      {!game && (
        <GameLog
          rows={logRows}
          games={new Map(games.map((g) => [g.id, g]))}
          mode={mode}
          base={`/shot-chart?${mode === "team" ? `team=${selectedId}` : `player=${selectedId}`}&season=${season}${
            side === "defense" ? "&side=defense" : ""
          }`}
        />
      )}

      {mode === "team" && <Roster seasons={rosters} initial={season} />}
    </main>
  );
}

/**
 * Zone stats counted straight from the shots, for a season too young for
 * the stats views (see `fitted` above). Same shape as a stats-view row;
 * the D1 average per zone comes from `baseSeason`.
 */
async function shotZoneStats(
  db: ReturnType<typeof createServerClient>,
  column: "team_id" | "opponent_id" | "player_id",
  id: number,
  season: number,
  baseSeason: number,
): Promise<{ data: ZoneStat[]; error: { message: string } | null }> {
  const [shots, { data: base, error: baseErr }] = await Promise.all([
    fetchAll<{ zone: Zone; made: boolean }>((from, to) =>
      db
        .from("shot_events")
        .select("zone, made")
        .eq("season", season)
        .eq(column, id)
        .not("zone", "is", null)
        .order("id")
        .range(from, to),
    ),
    db.from("zone_baselines").select("zone, fg_pct").eq("season", baseSeason),
  ]);
  if (shots.error) return { data: [], error: { message: shots.error } };
  if (baseErr) return { data: [], error: baseErr };

  const league = new Map((base ?? []).map((b) => [b.zone as Zone, Number(b.fg_pct)]));
  const byZone = new Map<Zone, { attempts: number; makes: number }>();
  for (const shot of shots.data) {
    const z = byZone.get(shot.zone) ?? { attempts: 0, makes: 0 };
    z.attempts++;
    if (shot.made) z.makes++;
    byZone.set(shot.zone, z);
  }
  const total = shots.data.length;
  return {
    data: [...byZone].map(([zone, { attempts, makes }]) => {
      const raw = makes / attempts;
      const avg = league.get(zone) ?? raw;
      return {
        zone,
        attempts,
        makes,
        raw_fg_pct: raw,
        fg_pct: raw,
        league_fg_pct: avg,
        fg_pct_vs_league: raw - avg,
        color_bucket: "neutral",
        attempt_share: attempts / total,
      };
    }),
    error: null,
  };
}

function conferenceHref(conference: string, season: number) {
  return `/shot-chart?conference=${encodeURIComponent(conference)}&season=${season}`;
}

const POSITION: Record<string, string> = { Guard: "G", Forward: "F", Center: "C" };

/**
 * A team's roster for each season. A season with roster rows (2026-27,
 * from the CBBD rosters scripts/project-2027.ts saves) lists everyone on
 * it; a season without (2025-26) lists everyone who took a shot for the
 * team. Each name links to the player's most recent chart: this season's
 * if he has one, otherwise last season's, wherever he played it.
 */
async function loadRosters(
  db: ReturnType<typeof createServerClient>,
  teamId: number,
  teamById: Map<number, TeamRow>,
): Promise<RosterSeason[]> {
  return Promise.all(
    SEASONS.map(async (season): Promise<RosterSeason> => {
      const label = `${seasonLabel(season)}`;
      const [{ data: listed }, { data: shooters }] = await Promise.all([
        db
          .from("player_seasons")
          .select("player_id, jersey, position, players(name)")
          .eq("season", season)
          .eq("team_id", teamId),
        db
          .from("player_season_totals")
          .select("player_id, player_name, team_id, attempts, makes")
          .eq("season", season)
          .eq("team_id", teamId),
      ]);

      if (!listed?.length) {
        const players = (shooters ?? [])
          .sort((a, b) => b.attempts - a.attempts)
          .map((p) => ({
            id: p.player_id,
            name: p.player_name,
            jersey: null,
            position: null,
            href: `/shot-chart?player=${p.player_id}&season=${season}`,
            note: `${p.attempts} FGA · ${p.attempts ? ((100 * p.makes) / p.attempts).toFixed(1) : "0.0"}%`,
          }));
        return { season, label, players };
      }

      // Last season's shots, for anyone on this roster: returning players
      // and transfers have a chart there; freshmen don't.
      const ids = listed.map((p) => p.player_id);
      const { data: before } = await db
        .from("player_season_totals")
        .select("player_id, team_id, attempts")
        .eq("season", season - 1)
        .in("player_id", ids);
      const now = new Map((shooters ?? []).map((p) => [p.player_id, p]));
      const prev = new Map<number, { team_id: number; attempts: number }>();
      for (const p of before ?? []) {
        // A mid-season transfer has a row per team; keep the bigger one.
        if ((prev.get(p.player_id)?.attempts ?? -1) < p.attempts) prev.set(p.player_id, p);
      }

      const players = listed
        .map((p): RosterPlayer & { rank: number[] } => {
          const name = (p.players as unknown as { name: string } | null)?.name ?? "Unknown";
          const cur = now.get(p.player_id);
          const old = prev.get(p.player_id);
          let href: string | null = null;
          let note = "No D1 shots yet";
          if (cur) {
            href = `/shot-chart?player=${p.player_id}&season=${season}`;
            note = `${cur.attempts} FGA`;
          } else if (old) {
            href = `/shot-chart?player=${p.player_id}&season=${season - 1}`;
            note =
              old.team_id === teamId
                ? `${old.attempts} FGA last season`
                : `Transfer from ${teamById.get(old.team_id)?.school ?? "another D1 team"}`;
          }
          return {
            id: p.player_id,
            name,
            jersey: p.jersey,
            position: p.position ? (POSITION[p.position] ?? p.position) : null,
            href,
            note,
            rank: [cur?.attempts ?? -1, old?.attempts ?? -1],
          };
        })
        // This season's shooters, then last season's, then newcomers.
        .sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || a.name.localeCompare(b.name))
        .map((p) => ({ ...p, rank: undefined }));
      return { season, label, players };
    }),
  );
}

/** A conference's members in one season, each linking to its chart. */
function ConferenceView({
  conference,
  season,
  teams,
  chartSeason,
}: {
  conference: string;
  season: number;
  teams: TeamRow[];
  chartSeason: (season: number) => number;
}) {
  const members = membersOf(conference, season, teams);
  // Realignment, against the season before: who joined, who left.
  const before = membersOf(conference, season - 1, teams);
  const was = new Set(before.map((t) => t.school));
  const is = new Set(members.map((t) => t.school));
  const joined = SEASONS.includes(season - 1) ? members.filter((t) => !was.has(t.school)) : [];
  const left = SEASONS.includes(season - 1) ? before.filter((t) => !is.has(t.school)) : [];
  const target = chartSeason(season);

  return (
    <main className="wrap">
      <header className="masthead">
        <span className="accent-rule" />
        <h1>{conference}</h1>
        <p className="sub">
          {seasonLabel(season)} · {members.length} teams
        </p>
        <nav className="season-toggle" aria-label="Season">
          {SEASONS.map((s) => (
            <Link
              key={s}
              href={conferenceHref(conference, s)}
              className={s === season ? "on" : ""}
              aria-current={s === season ? "page" : undefined}
              scroll={false}
            >
              {seasonLabel(s)}
            </Link>
          ))}
        </nav>
      </header>

      {members.length === 0 ? (
        <p className="empty-state">No Division I teams in the {conference} in {seasonLabel(season)}.</p>
      ) : (
        <ul className="conf-teams">
          {members.map((t) => (
            <li key={t.school}>
              {t.id ? (
                <Link href={`/shot-chart?team=${t.id}&season=${target}`}>{t.school}</Link>
              ) : (
                <span className="roster-nolink">{t.school}</span>
              )}
              {joined.some((j) => j.school === t.school) && <span className="conf-new">New</span>}
            </li>
          ))}
        </ul>
      )}

      {left.length > 0 && (
        <p className="conf-left">
          Left after {seasonLabel(season - 1)}:{" "}
          {left.map((t, i) => (
            <span key={t.school}>
              {i > 0 && ", "}
              {t.id ? <Link href={`/shot-chart?team=${t.id}&season=${target}`}>{t.school}</Link> : t.school}
            </span>
          ))}
        </p>
      )}
      {target !== season && (
        <p className="conf-left">
          {seasonLabel(season)} charts open once the season has enough shots; team links show{" "}
          {seasonLabel(target)} until then.
        </p>
      )}
    </main>
  );
}

type GameRow = GameMeta & { label: string };

/**
 * Games this season for the picker and the game log, oldest first: date,
 * opponent and the final score from `teamId`'s side. A team's come from
 * the games table; a player's are the games he took a shot in or has a
 * box score for (`extraIds`).
 */
async function loadGames(
  db: ReturnType<typeof createServerClient>,
  mode: "player" | "team",
  id: number,
  season: number,
  teamId: number | undefined,
  teamById: Map<number, TeamRow>,
  extraIds: number[] = [],
): Promise<GameRow[]> {
  if (!id || !teamId) return [];
  type G = {
    id: number;
    start_date: string | null;
    home_team_id: number | null;
    away_team_id: number | null;
    home_points: number | null;
    away_points: number | null;
  };
  const cols = "id, start_date, home_team_id, away_team_id, home_points, away_points";
  let rows: G[] = [];
  if (mode === "team") {
    const { data } = await db
      .from("games")
      .select(cols)
      .eq("season", season)
      .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
      .order("start_date");
    rows = (data ?? []) as G[];
  } else {
    const { data: shots } = await fetchAll<{ game_id: number }>((from, to) =>
      db
        .from("shot_events")
        .select("game_id")
        .eq("season", season)
        .eq("player_id", id)
        .order("id")
        .range(from, to),
    );
    const ids = [...new Set([...shots.map((r) => r.game_id), ...extraIds])];
    if (ids.length) {
      const { data } = await db.from("games").select(cols).in("id", ids).order("start_date");
      rows = (data ?? []) as G[];
    }
  }

  // Non-D1 opponents aren't in teamById; look their names up.
  const oppOf = (g: G) => (g.home_team_id === teamId ? g.away_team_id : g.home_team_id);
  const missing = [...new Set(rows.map(oppOf).filter((o): o is number => o !== null && !teamById.has(o)))];
  const names = new Map<number, string>();
  if (missing.length) {
    const { data } = await db.from("teams").select("id, school").in("id", missing);
    for (const t of data ?? []) names.set(t.id, t.school);
  }

  return rows.map((g) => {
    const home = g.home_team_id === teamId;
    const opp = oppOf(g);
    const oppName = (opp !== null && (teamById.get(opp)?.school ?? names.get(opp))) || "Opponent";
    const date = g.start_date
      ? new Date(g.start_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "America/New_York",
        })
      : "";
    const ours = home ? g.home_points : g.away_points;
    const theirs = home ? g.away_points : g.home_points;
    const result = ours !== null && theirs !== null ? `${ours > theirs ? "W" : "L"} ${ours}-${theirs}` : "";
    return {
      id: g.id,
      date,
      opponent: oppName,
      home,
      result,
      label: `${date} · ${home ? "vs" : "at"} ${oppName}${result ? ` · ${result}` : ""}`,
    };
  });
}

/** One game: every shot on the court, a box line, and who took them. */
function GameView({
  shots,
  mode,
  side,
  hasBox,
}: {
  shots: GameShot[];
  mode: "player" | "team";
  side: "offense" | "defense";
  /** Box scores show under the chart; the shooters table would repeat them. */
  hasBox: boolean;
}) {
  if (shots.length === 0) {
    return (
      <p className="empty-state">
        No shots recorded for this {mode} in this game. Some games have no shot tracking at all.
      </p>
    );
  }

  // Shots without a location count in the table but can't be drawn.
  const plotted = shots.filter((s) => s.x !== null && s.y !== null);
  const unplotted = shots.length - plotted.length;
  const line = (pick: (s: GameShot) => boolean) => {
    const set = shots.filter(pick);
    const made = set.filter((s) => s.made).length;
    return { made, att: set.length, pct: set.length ? (100 * made) / set.length : null };
  };
  const rows = [
    { label: "Field goals", ...line(() => true) },
    { label: "Threes", ...line((s) => s.score_value === 3) },
    { label: "Twos", ...line((s) => s.score_value !== 3) },
    { label: "At the rim", ...line((s) => s.zone === "restricted_area") },
  ];
  const byShooter = new Map<string, GameShot[]>();
  for (const s of shots) {
    const name = s.player_name ?? "Unknown";
    byShooter.set(name, [...(byShooter.get(name) ?? []), s]);
  }
  const shooters = [...byShooter]
    .map(([name, set]) => ({
      name,
      att: set.length,
      made: set.filter((s) => s.made).length,
      threes: set.filter((s) => s.score_value === 3).length,
      threesMade: set.filter((s) => s.score_value === 3 && s.made).length,
    }))
    .sort((a, b) => b.made - a.made || b.att - a.att);

  return (
    <div className="layout">
      <div className="chart-col">
        <figure className="chart">
          <GameChart shots={plotted} showShooter={mode === "team"} />
          <figcaption>
            {side === "defense"
              ? "Every shot opponents took against this team in this game."
              : "Every shot from this game, where it was taken."}
            {unplotted > 0 &&
              ` ${unplotted} shot${unplotted === 1 ? " has" : "s have"} no location and ${
                unplotted === 1 ? "isn't" : "aren't"
              } drawn, but count in the table.`}
          </figcaption>
        </figure>
      </div>

      <section className="breakdown">
        <table>
          <thead>
            <tr>
              <th>Shots</th>
              <th>Made</th>
              <th>FG%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">
                  {r.made}/{r.att}
                </td>
                <td className="num">{r.pct === null ? "–" : r.pct.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {mode === "team" && !hasBox && (
          <table className="game-shooters">
            <thead>
              <tr>
                <th>{side === "defense" ? "Opponent" : "Player"}</th>
                <th>FG</th>
                <th>3PT</th>
              </tr>
            </thead>
            <tbody>
              {shooters.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td className="num">
                    {p.made}/{p.att}
                  </td>
                  <td className="num">
                    {p.threesMade}/{p.threes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="accuracy-note">
          Field goals only: free throws aren&rsquo;t charted. Locations are recorded courtside,
          accurate to roughly a foot.
        </p>
      </section>
    </div>
  );
}

/** Dark or light text, whichever reads better on a team's color. */
function inkOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Crossover where dark (#14110F) and light (#F0EBE3) text tie on contrast.
  return lum > 0.18 ? "#14110F" : "#F0EBE3";
}

/** Surfaces a failed query instead of silently rendering a blank page. */
function Failure({ message }: { message: string }) {
  return (
    <main className="wrap">
      <h1 className="masthead">Can’t load shot data</h1>
      <p className="sub">{message}</p>
      <p className="sub">
        If this names a missing relation, the view hasn’t been created yet, or
        PostgREST can’t see it. Run the grants at the bottom of
        supabase/team-zones.sql.
      </p>
    </main>
  );
}

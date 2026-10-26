import Link from "next/link";
import { createServerClient } from "@/lib/supabase-server";
import { BUCKET_COLORS, ZONE_LABELS, ZONE_ORDER, type Zone } from "@/lib/court";
import ShotChart, { ZoneLegend, type ZoneStat } from "./ShotChart";
import ShotMix, { type LeagueTotals, type SeasonTotals } from "./ShotMix";
import EntityPicker, { type PickerItem } from "./EntityPicker";
import "./shot-chart.css";

/**
 * Seasons the chart can show, newest first, named by the year they end
 * (2027 is 2026-27). The live season fills in as scripts/update-shots.ts
 * imports games; a finished season never changes.
 */
const SEASONS = [2027, 2026];
const LIVE_SEASON = 2027;
const LIVE_SEASON_START = "November 2";
const LIVE_SEASON_NOTE_EARLY = "charts open once every zone has enough shots";
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
  searchParams: Promise<{ player?: string; team?: string; side?: string; season?: string }>;
}) {
  const params = await searchParams;
  const mode: "player" | "team" = params.team ? "team" : "player";
  // Defense is a team concept — a player has no defensive shot chart, so
  // the toggle is hidden in player mode and the param ignored there.
  const side: "offense" | "defense" =
    mode === "team" && params.side === "defense" ? "defense" : "offense";
  const db = createServerClient();

  // A season is shown only once every zone's small-sample correction can
  // be fitted from that season's own shots. The priors need players and
  // teams with real volume in each zone, and the stats views join them
  // with inner joins, so a season shown too early would silently drop
  // its thinly-shot zones (corner threes first) from every chart. Until
  // then the tab is visible but disabled.
  const [{ data: seasonRows }, { data: playerPriors }, { data: teamPriors }] = await Promise.all([
    db.from("d1_season_totals").select("season"),
    db.from("zone_priors").select("season, zone"),
    db.from("team_zone_priors").select("season, zone"),
  ]);
  const zones = new Set((playerPriors ?? []).map((p) => p.zone)).size;
  const ready = (s: number, rows: { season: number }[] | null) =>
    (rows ?? []).filter((r) => r.season === s).length >= zones;
  const hasShots = (s: number) => (seasonRows ?? []).some((r) => r.season === s);
  const available = SEASONS.filter(
    (s) => hasShots(s) && ready(s, playerPriors) && ready(s, teamPriors),
  );
  const requested = Number(params.season);
  const season = available.includes(requested) ? requested : (available[0] ?? SEASONS.at(-1)!);
  const minAttempts = season === LIVE_SEASON ? MIN_LIVE_ATTEMPTS : MIN_SEASON_ATTEMPTS;

  const { data: teamRows, error: teamErr } = await db
    .from("teams")
    .select("id, school, conference, primary_color, color_override")
    .eq("is_d1", true)
    .order("school");

  if (teamErr) return <Failure message={teamErr.message} />;

  const teams = (teamRows ?? []) as TeamRow[];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  let items: PickerItem[] = [];
  let selectedId: number;

  if (mode === "team") {
    items = teams.map((t) => ({
      id: t.id,
      name: t.school,
      detail: t.conference ?? "",
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

    items = candidates.map((row) => ({
      id: row.player_id,
      name: row.player_name,
      detail: teamById.get(row.team_id)?.school ?? "",
    }));
    selectedId = Number(params.player) || items[0]?.id;
  }

  const { data: statRows, error: statErr } =
    mode === "team"
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
  const stats = (statRows ?? []) as ZoneStat[];

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
    .eq("season", season)
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
  let subheading = "";
  let accent = "#6B5D4F";

  if (mode === "team") {
    const t = teamById.get(selectedId);
    heading = t?.school ?? "Team";
    subheading = t?.conference ?? "";
    accent = t?.color_override ?? t?.primary_color ?? accent;
  } else {
    const picked = items.find((i) => i.id === selectedId);
    heading = picked?.name ?? "Shot chart";
    subheading = picked?.detail ?? "";
    const team = teams.find((t) => t.school === picked?.detail);
    accent = team?.color_override ?? team?.primary_color ?? accent;
  }

  const { attempts, makes } = totals;

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
          {subheading ? `${subheading} · ` : ""}
          {seasonLabel(season)}
          {season === LIVE_SEASON ? " so far" : ""} ·{" "}
          {attempts.toLocaleString()} field goal attempts ·{" "}
          {attempts ? ((100 * makes) / attempts).toFixed(1) : "0"}%
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
            const subject = mode === "team" ? `team=${selectedId}` : `player=${selectedId}`;
            return (
              <Link
                key={s}
                href={`/shot-chart?${subject}&season=${s}`}
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
              href={`/shot-chart?team=${selectedId}&side=offense&season=${season}`}
              className={side === "offense" ? "on" : ""}
              scroll={false}
            >
              Shots taken
            </Link>
            <Link
              href={`/shot-chart?team=${selectedId}&side=defense&season=${season}`}
              className={side === "defense" ? "on" : ""}
              scroll={false}
            >
              Shots allowed
            </Link>
          </nav>
        )}
      </header>

      {stats.length === 0 ? (
        <p className="empty-state">
          No tracked shots for this {mode} in {seasonLabel(season)}
          {season === LIVE_SEASON ? " yet" : ""}. Some games have no shot tracking at all,
          which is most common in low-major matchups.
        </p>
      ) : (
        <div className="layout">
          <div className="chart-col">
            <figure className="chart">
              <ShotChart stats={stats} />
              <ZoneLegend mode={mode} />
              <figcaption>
                {side === "defense" ? (
                  <>
                    Color compares opponents against this team to the Division
                    I average in each zone, adjusted for how many shots were
                    actually taken there.
                  </>
                ) : (
                  <>
                    Color compares{" "}
                    {mode === "team" ? "this team" : "this player"} to the
                    Division I average in each zone, adjusted for how many
                    shots were actually taken there.
                  </>
                )}
              </figcaption>
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
                  if (!s) {
                    return (
                      <tr key={zone} className="empty">
                        <td>{ZONE_LABELS[zone]}</td>
                        <td colSpan={mode === "team" ? 4 : 3}>No attempts</td>
                      </tr>
                    );
                  }
                  const diff = 100 * s.fg_pct_vs_league;
                  return (
                    <tr key={zone}>
                      <td>
                        <span
                          className={
                            s.color_bucket === "gray" ? "swatch no-data" : "swatch"
                          }
                          style={{ background: BUCKET_COLORS[s.color_bucket] }}
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
                      {/* Raw, so it agrees with makes/attempts beside it.
                          The shrunk rate only drives color and vs D1. */}
                      <td className="num">{(100 * s.raw_fg_pct).toFixed(1)}</td>
                      <td className="num">
                        {s.color_bucket === "gray"
                          ? "—"
                          : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Floors match the gray cutoffs in team-zones.sql,
                team-defense-stats.sql and zones-and-baselines.sql. */}
            <p className="accuracy-note">
              FG% is the raw make rate. Colors and vs D1 use an adjusted rate
              that pulls small samples toward the Division I average, so a
              zone with few shots shows a smaller gap than its raw FG%
              suggests. Zones with fewer than {mode === "team" ? 25 : 5}{" "}
              attempts are gray: too few shots to say anything.
              {side === "defense" &&
                " Shots allowed are a rough read on defense: they reflect who a team played as much as how it defended, and opponent three-point shooting is largely luck."}
            </p>
          </section>
        </div>
      )}
    </main>
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

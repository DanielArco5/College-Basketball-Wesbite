import Link from "next/link";
import { createServerClient } from "@/lib/supabase-server";
import { BUCKET_COLORS, ZONE_LABELS, ZONE_ORDER, type Zone } from "@/lib/court";
import ShotChart, { type ZoneStat } from "./ShotChart";
import ShotDots, { type Shot } from "./ShotDots";
import EntityPicker, { type PickerItem } from "./EntityPicker";
import "./shot-chart.css";

const SEASON = 2026;
const MIN_SEASON_ATTEMPTS = 20;

// Last season's games are finished, so the numbers behind this page never
// change. Re-querying Postgres on every request buys nothing.
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
  searchParams: Promise<{ player?: string; team?: string; view?: string }>;
}) {
  const params = await searchParams;
  const mode: "player" | "team" = params.team ? "team" : "player";
  const view: "zones" | "shots" = params.view === "shots" ? "shots" : "zones";
  const db = createServerClient();

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
    const { data: candidates, error } = await db
      .from("player_season_totals")
      .select("player_id, player_name, team_id, attempts")
      .eq("season", SEASON)
      .gte("attempts", MIN_SEASON_ATTEMPTS)
      .order("player_name")
      .limit(20000);

    if (error) return <Failure message={error.message} />;

    items = (candidates ?? []).map((row) => ({
      id: row.player_id,
      name: row.player_name,
      detail: teamById.get(row.team_id)?.school ?? "",
    }));
    selectedId = Number(params.player) || items[0]?.id;
  }

  // Zone stats drive the table in both views, so they're always fetched.
  const { data: statRows, error: statErr } =
    mode === "team"
      ? await db
          .from("team_zone_stats")
          .select("*")
          .eq("season", SEASON)
          .eq("team_id", selectedId)
      : await db
          .from("player_zone_stats")
          .select("*")
          .eq("season", SEASON)
          .eq("player_id", selectedId);

  if (statErr) return <Failure message={statErr.message} />;
  const stats = (statRows ?? []) as (ZoneStat & { attempt_share?: number })[];

  // Raw locations, only when they're going to be drawn.
  let shots: Shot[] = [];
  if (view === "shots") {
    const q = db
      .from("shot_events")
      .select("x, y, made")
      .eq("season", SEASON)
      .not("zone", "is", null) // field goals only, matching the table
      .limit(4000);

    const { data: shotRows, error: shotErr } =
      mode === "team"
        ? await q.eq("team_id", selectedId)
        : await q.eq("player_id", selectedId);

    if (shotErr) return <Failure message={shotErr.message} />;
    shots = (shotRows ?? []) as Shot[];
  }

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

  const attempts = stats.reduce((n, s) => n + s.attempts, 0);
  const makes = stats.reduce((n, s) => n + s.makes, 0);

  const base = mode === "team" ? `team=${selectedId}` : `player=${selectedId}`;

  return (
    <main className="wrap" style={{ ["--accent" as string]: accent }}>
      <header className="masthead">
        <span className="accent-rule" />
        <h1>{heading}</h1>
        <p className="sub">
          {subheading ? `${subheading} · ` : ""}
          {SEASON - 1}–{String(SEASON).slice(2)} ·{" "}
          {attempts.toLocaleString()} field goal attempts ·{" "}
          {attempts ? ((100 * makes) / attempts).toFixed(1) : "0"}%
        </p>
        <EntityPicker mode={mode} items={items} selectedName={heading} />

        <nav className="view-toggle">
          <Link
            href={`/shot-chart?${base}&view=zones`}
            className={view === "zones" ? "on" : ""}
            scroll={false}
          >
            Accuracy by zone
          </Link>
          <Link
            href={`/shot-chart?${base}&view=shots`}
            className={view === "shots" ? "on" : ""}
            scroll={false}
          >
            Every shot
          </Link>
        </nav>
      </header>

      {stats.length === 0 ? (
        <p className="empty-state">
          No tracked shots for this {mode} in {SEASON - 1}–
          {String(SEASON).slice(2)}. Some games have no shot tracking at all,
          which is most common in low-major matchups.
        </p>
      ) : (
        <div className="layout">
          <figure className="chart">
            {view === "shots" ? (
              <>
                <ShotDots shots={shots} />
                <figcaption>
                  Each mark is one shot — filled for a make, open for a miss.
                  Locations are recorded courtside and are accurate to about a
                  foot, so read the pattern rather than any single dot.
                  {shots.length >= 4000 && " Showing the first 4,000."}
                </figcaption>
              </>
            ) : (
              <>
                <ShotChart stats={stats} />
                <figcaption>
                  Color compares {mode === "team" ? "this team" : "this player"}{" "}
                  to the Division I average in each zone, adjusted for how many
                  shots were actually taken there.
                </figcaption>
              </>
            )}
          </figure>

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
                          className="swatch"
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
                      <td className="num">{(100 * s.fg_pct).toFixed(1)}</td>
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

            {view === "zones" && (
              <ul className="legend">
                {[
                  ["hot", "Well above average"],
                  ["warm", "Above average"],
                  ["neutral", "About average"],
                  ["cool", "Below average"],
                  ["cold", "Well below average"],
                  ["gray", "Too few attempts to say"],
                ].map(([bucket, label]) => (
                  <li key={bucket}>
                    <span
                      className="swatch"
                      style={{ background: BUCKET_COLORS[bucket] }}
                    />
                    {label}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
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

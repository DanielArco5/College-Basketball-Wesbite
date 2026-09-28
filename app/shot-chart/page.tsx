import { createServerClient } from "@/lib/supabase-server";
import { BUCKET_COLORS, ZONE_LABELS, ZONE_ORDER, type Zone } from "@/lib/court";
import ShotChart, { type ZoneStat } from "./ShotChart";
import EntityPicker, { type PickerItem } from "./EntityPicker";
import "./shot-chart.css";

const SEASON = 2026;

export const metadata = { title: "Shot charts" };

type TeamRow = { id: number; school: string; conference: string | null; primary_color: string | null; color_override: string | null };

export default async function ShotChartPage({
  searchParams,
}: {
  searchParams: Promise<{ player?: string; team?: string }>;
}) {
  const params = await searchParams;
  const mode: "player" | "team" = params.team ? "team" : "player";
  const db = createServerClient();

  const { data: teamRows, error: teamErr } = await db
    .from("teams")
    .select("id, school, conference, primary_color, color_override")
    .eq("is_d1", true)
    .order("school");

  if (teamErr) return <Failure message={teamErr.message} />;

  const teams = (teamRows ?? []) as TeamRow[];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // ---------------------------------------------------------------
  // Build the picker list for whichever mode we're in
  // ---------------------------------------------------------------
  let items: PickerItem[] = [];
  let selectedId: number;
  let heading = "";
  let subheading = "";
  let accent = "#6B5D4F";

  if (mode === "team") {
    items = teams.map((t) => ({
      id: t.id,
      name: t.school,
      detail: t.conference ?? "",
    }));
    selectedId = Number(params.team) || teams[0]?.id;
  } else {
    const { data: candidates, error } = await db
      .from("player_zone_stats")
      .select("player_id, player_name, team_id, attempts")
      .eq("season", SEASON)
      .gte("attempts", 40)
      .order("attempts", { ascending: false })
      .limit(4000);

    if (error) return <Failure message={error.message} />;

    const seen = new Map<number, PickerItem>();
    for (const row of candidates ?? []) {
      if (seen.has(row.player_id)) continue;
      seen.set(row.player_id, {
        id: row.player_id,
        name: row.player_name,
        detail: teamById.get(row.team_id)?.school ?? "",
      });
    }
    items = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    selectedId = Number(params.player) || items[0]?.id;
  }

  // ---------------------------------------------------------------
  // Stats for the selection
  // ---------------------------------------------------------------
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
            <ShotChart stats={stats} />
            <figcaption>
              Color compares {mode === "team" ? "this team" : "this player"} to
              the Division I average in each zone, adjusted for how many shots
              were actually taken there.
            </figcaption>
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

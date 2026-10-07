import { createServerClient } from "@/lib/supabase-server";
import { BUCKET_COLORS, ZONE_LABELS, ZONE_ORDER, type Zone } from "@/lib/court";
import ShotChart, { ZoneLegend, type ZoneStat } from "./ShotChart";
import ShotMix from "./ShotMix";
import EntityPicker, { type PickerItem } from "./EntityPicker";
import "./shot-chart.css";

const SEASON = 2026;
const MIN_SEASON_ATTEMPTS = 20;

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
        .eq("season", SEASON)
        .gte("attempts", MIN_SEASON_ATTEMPTS)
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
          <div className="chart-col">
            <figure className="chart">
              <ShotChart stats={stats} />
              <ZoneLegend mode={mode} />
              <figcaption>
                Color compares {mode === "team" ? "this team" : "this player"}{" "}
                to the Division I average in each zone, adjusted for how many
                shots were actually taken there.
              </figcaption>
            </figure>

            <ShotMix stats={stats} />
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

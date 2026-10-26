import Link from "next/link";
import { createServerClient } from "@/lib/supabase-server";
import { RATINGS_SEASON } from "@/lib/ratings";
import { buildComposite } from "@/lib/preseason";
import { RatingsCaveat } from "./rankings/RatingsTable";
import { PreseasonMethod, PreseasonTable, loadTeamIds } from "./rankings/Preseason";
import type { WireEntry } from "./LiveWire";
import "./home.css";
import "./rankings/rankings.css";

type Db = ReturnType<typeof createServerClient>;

/**
 * Tabs are links, not client state: each one has its own URL, so a tab
 * can be bookmarked or shared and the back button behaves. Only the
 * active tab's data is fetched.
 */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "top25", label: "Top 25" },
  { key: "teams", label: "Shot charts" },
  { key: "method", label: "How it works" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const SEASON_LABEL = `${RATINGS_SEASON - 1}–${String(RATINGS_SEASON).slice(2)}`;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab: TabKey =
    TABS.find((t) => t.key === params.tab)?.key ?? "overview";
  const db = createServerClient();

  return (
    <main className="home">
      <header className="home-head">
        <h1>
          Every shot,
          <br />
          every team.
        </h1>
        <p className="home-lede">
          The 2026&ndash;27 preseason Top 25, built from KenPom, Torvik, EvanMiya
          and ESPN, plus shot locations for every Division I team from
          {SEASON_LABEL}.
        </p>
      </header>

      <nav className="home-tabs" aria-label="Home sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? "/" : `/?tab=${t.key}`}
            className={tab === t.key ? "is-active" : ""}
            aria-current={tab === t.key ? "page" : undefined}
            scroll={false}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <section className="home-panel">
        {tab === "overview" && <Overview db={db} />}
        {tab === "top25" && <Top25 db={db} />}
        {tab === "teams" && <Teams db={db} />}
        {tab === "method" && <Method />}
      </section>
    </main>
  );
}

// ── Overview ──────────────────────────────────────────────────────────

async function Overview({ db }: { db: Db }) {
  const [counts, wire, teamIds] = await Promise.all([
    // Precomputed in site-counts.sql. If the view is missing or the read
    // fails, hide the line rather than show zeros.
    db
      .from("site_counts")
      .select("shots, games, players, teams")
      .eq("season", RATINGS_SEASON)
      .maybeSingle<{
        shots: number;
        games: number;
        players: number;
        teams: number;
      }>(),
    db
      .from("live_wire_entries")
      .select("id, kind, headline, url, published_at")
      .eq("is_live", true)
      .order("published_at", { ascending: false })
      .limit(5),
    loadTeamIds(db),
  ]);

  const stats = counts.data;
  const entries = (wire.data ?? []) as WireEntry[];
  const top = buildComposite().slice(0, 10);

  return (
    <>
      {stats && (
        <dl className="home-stats">
          <div>
            <dt>Shots charted</dt>
            <dd>{stats.shots.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Games</dt>
            <dd>{stats.games.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Players</dt>
            <dd>{stats.players.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Teams</dt>
            <dd>{stats.teams.toLocaleString()}</dd>
          </div>
        </dl>
      )}

      <div className="home-grid">
        <div className="home-block">
          <h2>
            Top 10 <span className="home-block-season">2026&ndash;27 preseason</span>
          </h2>
          <ol className="home-top">
            {top.map((r) => {
              const id = teamIds.get(r.school);
              return (
                <li key={r.school}>
                  <span className="home-top-rk">{r.rk}</span>
                  {id ? (
                    <Link href={`/shot-chart?team=${id}`}>{r.school}</Link>
                  ) : (
                    r.school
                  )}
                  <span className="home-top-net" title="Average rank across sources">
                    {r.avg.toFixed(1)}
                  </span>
                </li>
              );
            })}
          </ol>
          <Link href="/?tab=top25" className="home-more" scroll={false}>
            Full Top 25
          </Link>
        </div>

        <div className="home-block">
          <h2>Live Wire</h2>
          {entries.length === 0 ? (
            <p className="home-empty">No news posted yet.</p>
          ) : (
            <ul className="home-wire">
              {entries.map((e) => (
                <li key={e.id}>
                  <span className={`wire-kind k-${e.kind}`}>{e.kind}</span>
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer">
                      {e.headline}
                    </a>
                  ) : (
                    e.headline
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <nav className="home-nav" aria-label="Sections">
        <Link href="/shot-chart" className="home-card">
          <span className="home-card-season">{SEASON_LABEL} season</span>
          <h2>Shot charts</h2>
          <p>
            Where a player or team shoots from, and how well, zone by zone.
            Switch to the defensive side to see what a team allows.
          </p>
        </Link>

        <Link href="/rankings" className="home-card">
          <span className="home-card-season">2026&ndash;27 preseason</span>
          <h2>Top 25</h2>
          <p>
            KenPom, Torvik, EvanMiya and ESPN averaged into one ranking, with
            every source&rsquo;s number shown beside it.
          </p>
        </Link>
      </nav>
    </>
  );
}

// ── Top 25 ────────────────────────────────────────────────────────────

async function Top25({ db }: { db: Db }) {
  const teamIds = await loadTeamIds(db);

  return (
    <>
      <p className="home-intro">
        2026&ndash;27 preseason composite. Each column is that source&rsquo;s own
        rank; the{" "}
        <Link href="/?tab=method" scroll={false}>
          method
        </Link>{" "}
        explains NR and the dashes.
      </p>
      <PreseasonTable rows={buildComposite().slice(0, 25)} teamIds={teamIds} />
      <Link href="/rankings" className="home-more">
        Full list and sources
      </Link>
    </>
  );
}

// ── Shot charts (team directory) ──────────────────────────────────────

async function Teams({ db }: { db: Db }) {
  const { data, error } = await db
    .from("teams")
    .select("id, school, conference")
    .eq("is_d1", true)
    .order("school");

  if (error) {
    return <p className="home-empty">Can&rsquo;t load teams: {error.message}</p>;
  }

  const byConf = new Map<string, { id: number; school: string }[]>();
  for (const t of data ?? []) {
    const conf = t.conference ?? "Independent";
    if (!byConf.has(conf)) byConf.set(conf, []);
    byConf.get(conf)!.push(t);
  }
  const conferences = [...byConf.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <>
      <p className="home-intro">
        Pick a team to open its shot chart, or{" "}
        <Link href="/shot-chart">search for a player</Link>.
      </p>
      <div className="home-confs">
        {conferences.map(([conf, teams]) => (
          <section key={conf} className="home-conf">
            <h3>{conf}</h3>
            <ul>
              {teams.map((t) => (
                <li key={t.id}>
                  <Link href={`/shot-chart?team=${t.id}`}>{t.school}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

// ── How it works ──────────────────────────────────────────────────────

function Method() {
  return (
    <div className="home-method">
      <h2>Shot charts</h2>
      <p>
        A player who goes 4-for-6 from the corner has shot 67 percent, and a
        chart that paints him bright red is lying to you. Every rate on this
        site is pulled toward the Division I average by an amount fitted
        separately for each zone from how much players actually differ there.
        A handful of shots barely moves the color; a full season mostly
        speaks for itself.
      </p>
      <p>
        Below the attempt threshold a zone is drawn gray rather than neutral.
        Gray means there isn&rsquo;t enough data to say. Neutral would claim he
        is exactly average, which is a different and unsupported statement.
      </p>

      <PreseasonMethod />

      <h2>Last season&rsquo;s shooting ratings</h2>
      <p>
        Each team&rsquo;s offense is the points it scored per field goal
        attempt, and its defense is the points it allowed. Both are adjusted
        for opponents: scoring well against a strong defense counts for more
        than scoring well against a weak one. Net is offense minus defense.
      </p>
      <RatingsCaveat />

      <h2>Live Wire</h2>
      <p>
        There is no feed for college basketball transfer and injury news, so
        every Live Wire entry is written by hand. You can hide the ticker
        with the button at its right edge, and your browser will remember
        the choice.
      </p>

      <footer className="home-foot">
        <p>
          Shot data from CollegeBasketballData. Some games have no shot
          tracking; those shots count in season totals but can&rsquo;t be
          placed on a chart.
        </p>
      </footer>
    </div>
  );
}

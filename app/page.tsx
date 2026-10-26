import Link from "next/link";
import { createServerClient } from "@/lib/supabase-server";
import { buildComposite } from "@/lib/preseason";
import type { WireEntry } from "./LiveWire";
import { PreseasonMethod, PreseasonTable, loadTeamIds } from "./rankings/Preseason";
import { FormulaMethod, FormulaRanking } from "./rankings/Formula";
import "./home.css";
import "./rankings/rankings.css";

export const metadata = {
  title: { absolute: "College basketball shot charts and the 2026-27 Top 25" },
  description:
    "Shot locations for every Division I team and player, and a 2026-27 " +
    "preseason Top 25 built from KenPom, Torvik and ESPN.",
};

type Db = ReturnType<typeof createServerClient>;

type Counts = {
  shots: number;
  games: number;
  players: number;
  teams: number;
};

/**
 * One tab per section. Tabs are links, not client state: each has its own
 * URL, so a tab can be bookmarked or shared and the back button behaves.
 * Only the active tab's data is fetched.
 */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "top25", label: "Top 25" },
  { key: "formula", label: "Our Top 25" },
  { key: "shots", label: "Shot charts" },
  { key: "wire", label: "Live Wire" },
  { key: "method", label: "How it works" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab: TabKey = TABS.find((t) => t.key === params.tab)?.key ?? "overview";
  const db = createServerClient();

  // Counts sit in the header on every tab. If the view is missing or the
  // read fails, the line is hidden rather than showing zeros.
  const { data: counts } = await db
    .from("site_counts")
    .select("shots, games, players, teams")
    .eq("season", 2026)
    .maybeSingle<Counts>();

  return (
    <main className="home">
      <header className="home-hero">
        <h1>
          Every shot,
          <br />
          every team.
        </h1>
        <p className="home-lede">
          The 2026-27 preseason Top 25, and shot locations for all 365
          Division I teams from 2025-26, mapped to the floor and measured
          against what the rest of the country does from the same spot.
        </p>
        {counts && (
          <p className="home-counts">
            {counts.shots.toLocaleString()} field goal attempts ·{" "}
            {counts.games.toLocaleString()} games ·{" "}
            {counts.players.toLocaleString()} players
          </p>
        )}
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

      <div className="home-panel">
        {tab === "overview" && <Overview db={db} />}
        {tab === "top25" && <Top25 db={db} />}
        {tab === "formula" && <OurTop25 />}
        {tab === "shots" && <ShotCharts db={db} />}
        {tab === "wire" && <Wire db={db} />}
        {tab === "method" && <Method />}
      </div>

      <footer className="home-foot">
        <p>
          Shot data from CollegeBasketballData. Locations are recorded
          courtside rather than optically tracked, so they&rsquo;re accurate
          to roughly a foot — enough to say &ldquo;left wing, about
          sixteen feet,&rdquo; not enough to read precisely.
        </p>
      </footer>
    </main>
  );
}

// ── Overview ──────────────────────────────────────────────────────────

async function Overview({ db }: { db: Db }) {
  const teamIds = await loadTeamIds(db);
  const top = buildComposite().slice(0, 10);

  return (
    <>
      <section className="home-sections">
        <h2 className="home-h2">What&rsquo;s here</h2>

        <div className="home-grid">
          <Link href="/?tab=top25" className="home-card" scroll={false}>
            <span className="home-card-season">2026-27 preseason</span>
            <h3>Top 25</h3>
            <p>
              KenPom, Torvik and ESPN averaged into one ranking,
              with every source&rsquo;s own number shown beside it so you can
              see where they disagree.
            </p>
            <span className="home-card-go">Open the Top 25</span>
          </Link>

          <Link href="/?tab=shots" className="home-card" scroll={false}>
            <span className="home-card-season">2025-26 season</span>
            <h3>Shot charts</h3>
            <p>
              Where a player or team shoots from and how well, zone by zone.
              Switch to the defensive side of a team to see what it allows
              rather than what it scores.
            </p>
            <span className="home-card-go">Pick a team</span>
          </Link>

          <Link href="/?tab=wire" className="home-card" scroll={false}>
            <span className="home-card-season">Updated by hand</span>
            <h3>Live Wire</h3>
            <p>
              Transfers, commitments and injury news across the top of every
              page. There&rsquo;s no feed for this in college basketball, so
              each item is written rather than scraped. Hide it with the
              button at the right of the bar.
            </p>
            <span className="home-card-go">Read the latest</span>
          </Link>
        </div>
      </section>

      <section className="home-top">
        <h2 className="home-h2">
          Top ten, 2026-27 preseason
          <Link href="/?tab=top25" className="home-h2-link" scroll={false}>
            Full Top 25
          </Link>
        </h2>
        <ol className="home-top-list">
          {top.map((t) => {
            const id = teamIds.get(t.school);
            return (
              <li key={t.school}>
                <span className="home-top-rk">{t.rk}</span>
                <span className="home-top-team">
                  {id ? (
                    <Link href={`/shot-chart?team=${id}`}>{t.school}</Link>
                  ) : (
                    t.school
                  )}
                </span>
                <span className="home-top-conf">
                  {t.used} source{t.used === 1 ? "" : "s"}
                </span>
                <span className="home-top-net" title="Average rank across sources">
                  {t.avg.toFixed(1)}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

// ── Top 25 ────────────────────────────────────────────────────────────

async function Top25({ db }: { db: Db }) {
  const teamIds = await loadTeamIds(db);

  return (
    <section>
      <h2 className="home-h2">
        Top 25, 2026-27 preseason
        <Link href="/rankings" className="home-h2-link">
          Full list
        </Link>
      </h2>
      <p className="home-intro">
        Each column is that source&rsquo;s own rank, and Avg is the composite.{" "}
        <Link href="/?tab=method" scroll={false}>
          How it works
        </Link>{" "}
        explains NR and the dashes.
      </p>
      <PreseasonTable rows={buildComposite().slice(0, 25)} teamIds={teamIds} />
    </section>
  );
}

// ── Our Top 25 ────────────────────────────────────────────────────────

function OurTop25() {
  return (
    <section>
      <h2 className="home-h2">
        Our Top 25, 2026-27 preseason
        <Link href="/rankings?view=formula" className="home-h2-link">
          Full page
        </Link>
      </h2>
      <p className="home-intro">
        Our own formula, using no outside rankings: every returning player
        and transfer valued by what they did last season.{" "}
        <Link href="/?tab=method" scroll={false}>
          How it works
        </Link>{" "}
        has the details.
      </p>
      <FormulaRanking />
    </section>
  );
}

// ── Shot charts (team directory) ──────────────────────────────────────

async function ShotCharts({ db }: { db: Db }) {
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
    <section>
      <h2 className="home-h2">
        Shot charts, 2025-26
        <Link href="/shot-chart" className="home-h2-link">
          Search players
        </Link>
      </h2>
      <p className="home-intro">
        Pick a team to open its shot chart. On a team&rsquo;s page, switch to
        &ldquo;Shots allowed&rdquo; to see its defense.
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
    </section>
  );
}

// ── Live Wire ─────────────────────────────────────────────────────────

const KIND_LABEL: Record<WireEntry["kind"], string> = {
  transfer: "Transfer",
  commitment: "Commit",
  injury: "Injury",
  note: "Note",
};

async function Wire({ db }: { db: Db }) {
  const { data } = await db
    .from("live_wire_entries")
    .select("id, kind, headline, url, published_at")
    .eq("is_live", true)
    .order("published_at", { ascending: false })
    .limit(30);

  const entries = (data ?? []) as WireEntry[];

  return (
    <section>
      <h2 className="home-h2">Live Wire</h2>
      <p className="home-intro">
        Every entry is written by hand; there&rsquo;s no transfer or injury
        feed for college basketball to pull from. The same items scroll
        across the top of every page, and you can hide that bar with the
        button at its right edge.
      </p>
      {entries.length === 0 ? (
        <p className="home-empty">Nothing posted yet.</p>
      ) : (
        <ul className="home-wire">
          {entries.map((e) => (
            <li key={e.id}>
              <span className={`wire-kind k-${e.kind}`}>
                {KIND_LABEL[e.kind]} ·{" "}
                {new Date(e.published_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "America/New_York",
                })}
              </span>
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
    </section>
  );
}

// ── How it works ──────────────────────────────────────────────────────

function Method() {
  return (
    <>
      <section className="home-method">
        <h2 className="home-h2">How the shot charts work</h2>

        <div className="home-method-body">
          <article>
            <h3>Small samples lie, so they&rsquo;re pulled toward average</h3>
            <p>
              A player who goes 2-for-4 from the corner has shot 50 percent,
              and a chart that paints him bright red is lying to you. Every
              rate here is pulled toward the Division I average by an amount
              fitted to how much players actually differ in that zone —
              hard at the rim, where almost everyone finishes layups alike,
              and gently from three, where the spread between shooters is
              real.
            </p>
            <p>
              The effect is measurable. Sorted by volume, the gap between
              raw percentage and true ability collapses from .325 to .044 as
              attempts rise, which is noise disappearing. After the
              adjustment the gap stays flat around .035 at every volume. No
              player under five attempts reaches a hot or cold color.
            </p>
          </article>

          <article>
            <h3>Not enough data is drawn gray, not neutral</h3>
            <p>
              Below the attempt threshold a zone is gray. Gray means
              there isn&rsquo;t enough to say. A neutral color would claim
              the player is exactly average there, which is a different
              statement and an unsupported one.
            </p>
          </article>
        </div>
      </section>

      <PreseasonMethod />

      <FormulaMethod />

      <section className="home-method">
        <h2 className="home-h2">
          Last season&rsquo;s shooting ratings
          <Link href="/rankings?view=last" className="home-h2-link">
            See the table
          </Link>
        </h2>

        <div className="home-method-body">
          <article>
            <h3>Schedule is adjusted for, because it has to be</h3>
            <p>
              Before adjustment the top of the ratings filled with mid-major
              teams. Belmont&rsquo;s offense really is efficient — against
              the Missouri Valley. An unadjusted rating counts a bucket
              against Evansville the same as one against Houston.
            </p>
            <p>
              So a team&rsquo;s offense is credited for the defenses it
              faced, and those defenses are themselves rated against the
              offenses <em>they</em> faced, repeated until the numbers
              settle. It&rsquo;s the same shape as KenPom&rsquo;s adjusted
              efficiency, applied to points per shot.
            </p>
          </article>

          <article>
            <h3>What this doesn&rsquo;t measure</h3>
            <p>
              The ratings are points per <em>field goal attempt</em>, not
              per possession. Turnovers, offensive rebounds and free throws
              aren&rsquo;t in the data, and together they&rsquo;re a large
              share of what separates teams. A team that shoots well and
              gives the ball away constantly will rate better here than it
              deserves.
            </p>
            <p>
              They also describe 2025-26 and aren&rsquo;t used in the 2026-27
              Top 25, which comes entirely from the three outside sources.
            </p>
          </article>
        </div>
      </section>
    </>
  );
}

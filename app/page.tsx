import Link from "next/link";
import { createServerClient } from "@/lib/supabase-server";
import { getRanking, type Ranking } from "@/lib/rankings";
import { getWire } from "@/lib/wire";
import type { WireEntry } from "./LiveWire";
import { FormulaMethod, FormulaRanking } from "./rankings/Formula";
import { LogoMark } from "./Logo";
import "./home.css";
import "./rankings/rankings.css";

export const metadata = {
  title: { absolute: "CBB · College basketball, ranked on hustle and efficiency" },
  description:
    "A 2026-27 Top 25 that blends our box-score formula with KenPom, " +
    "Torvik and ESPN, plus shot charts for every Division I team and player.",
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
  const ranking = await getRanking();
  const { formula } = ranking;

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
        <div className="home-brand">
          <LogoMark size={56} />
          <span className="home-kicker">
            {formula.stage === "in-season" ? "2026–27 season" : "2026–27 preseason"}
          </span>
        </div>
        <h1>
          The teams that work
          <br />
          for every possession.
        </h1>
        <div className="home-intro-copy">
          <p className="home-lede">
            CBB ranks college basketball on how games are actually won:
            efficient offense, real defense, second chances off the glass and
            the turnover battle, every number adjusted for who a team played.
            Our own box-score formula is weighed against the established
            preseason rankings from KenPom, Torvik and ESPN, so the Top 25
            agrees with the experts where the evidence is strong and breaks
            from them where our numbers see something they don&rsquo;t.
          </p>
          <p>
            {formula.stage === "in-season" ? (
              <>
                The season is underway. Real 2026&ndash;27 numbers from the
                NCAA&rsquo;s official stats now count alongside the preseason
                projection, and take over more each week as teams play more
                games.
              </>
            ) : (
              <>
                Until tip-off on November 2 it&rsquo;s a projection: every
                returning player and transfer, followed to his new team and
                measured by what he did last season. Once games start, real
                2026&ndash;27 numbers from the NCAA&rsquo;s official stats take
                over a little more each week.
              </>
            )}
          </p>
          <p>
            Alongside it are a shot chart for every team and player from
            2025&ndash;26, and Live Wire, the day&rsquo;s college basketball
            news from ESPN and CBS Sports, running across the top of every
            page.
          </p>
        </div>
        <p className="home-actions">
          {/* A full page, not a tab switch: a tab changes below the fold
              without scrolling, which reads as a dead button. */}
          <Link href="/rankings" className="home-action is-primary">
            See the Top 25
          </Link>
        </p>
        {counts && (
          <p className="home-counts">
            {counts.shots.toLocaleString()} shots charted ·{" "}
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
        {tab === "overview" && <Overview ranking={ranking} />}
        {tab === "top25" && <Top25 ranking={ranking} />}
        {tab === "shots" && <ShotCharts db={db} />}
        {tab === "wire" && <Wire />}
        {tab === "method" && <Method ranking={ranking} />}
      </div>

      <footer className="home-foot">
        <p>
          Box scores and shot locations from CollegeBasketballData;
          2026&ndash;27 team stats from NCAA.com once the season starts. Shot
          locations are recorded courtside, accurate to roughly a foot.
        </p>
      </footer>
    </main>
  );
}

// ── Overview ──────────────────────────────────────────────────────────

function Overview({ ranking }: { ranking: Ranking }) {
  const top = ranking.rows.slice(0, 10);

  return (
    <>
      <section className="home-top">
        <h2 className="home-h2">
          Top ten, 2026-27 preseason
          <Link href="/?tab=top25" className="home-h2-link" scroll={false}>
            Full Top 25
          </Link>
        </h2>
        <ol className="home-top-list">
          {top.map((t) => (
            <li key={t.team_id}>
              <span className="home-top-rk">{t.rk}</span>
              <span className="home-top-team">
                <Link href={`/shot-chart?team=${t.team_id}`}>{t.school}</Link>
              </span>
              <span className="home-top-conf">{t.conference}</span>
              {t.pinned ? (
                <span className="home-top-net" title={t.note ?? "Placed by hand"}>
                  Our pick
                </span>
              ) : (
                <span className="home-top-net" title="Formula score; 0 is a typical D1 team">
                  {t.score > 0 ? "+" : ""}
                  {t.score.toFixed(2)}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

// ── Top 25 ────────────────────────────────────────────────────────────

function Top25({ ranking }: { ranking: Ranking }) {
  return (
    <section>
      <h2 className="home-h2">
        Top 25, 2026-27 preseason
        <Link href="/rankings" className="home-h2-link">
          Full page
        </Link>
      </h2>
      <p className="home-intro">
        Our box-score formula blended with the KenPom, Torvik and ESPN
        preseason rankings.{" "}
        <Link href="/?tab=method" scroll={false}>
          How it works
        </Link>{" "}
        has the weights.
      </p>
      <FormulaRanking ranking={ranking} />
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
  live: "Live",
  score: "Final",
  scorer: "Top scorer",
};

async function Wire() {
  const entries = await getWire();

  return (
    <section>
      <h2 className="home-h2">Live Wire</h2>
      <p className="home-intro">
        The day&rsquo;s biggest scores and scoring nights first, live
        during games, then the past week&rsquo;s injuries, then the rest of
        the news: headlines from ESPN and CBS Sports, checked every few
        hours, plus notes of our own. The same items scroll across the top of every page, and you can
        hide that bar with the button at its right edge.
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
                {e.source && <> · {e.source}</>}
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

function Method({ ranking }: { ranking: Ranking }) {
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

      <FormulaMethod formula={ranking.formula} />

    </>
  );
}

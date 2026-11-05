import Link from "next/link";

/** Small pieces the ranking pages share. */

type Game = { date: string; opponent: string; site: string; won?: boolean; score?: string } | null;

export const where = (site: string) => (site === "home" ? "vs" : site === "away" ? "at" : "vs");
const dayOf = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", ...opts });

export function LastGame({ game }: { game: Game }) {
  if (!game) return <span className="rank-dim">&ndash;</span>;
  return (
    <>
      <span className={game.won ? "rank-w" : "rank-l"}>
        {game.won ? "W" : "L"} {game.score}
      </span>{" "}
      {where(game.site)} {game.opponent}
      {game.site === "neutral" && <span className="rank-dim"> (N)</span>}
      <span className="rank-sub">{dayOf(game.date, { month: "short", day: "numeric" })}</span>
    </>
  );
}

export function NextGame({ game }: { game: Game }) {
  if (!game) return <span className="rank-dim">&ndash;</span>;
  return (
    <>
      {where(game.site)} {game.opponent}
      {game.site === "neutral" && <span className="rank-dim"> (N)</span>}
      <span className="rank-sub">
        {dayOf(game.date, { weekday: "short", month: "short", day: "numeric" })}
      </span>
    </>
  );
}

/** Up or down since yesterday's ranking. */
export function Move({ now, before }: { now: number; before: number | null | undefined }) {
  if (!before) return <span className="rank-move is-new" title="New since yesterday">new</span>;
  const d = before - now;
  if (!d) return <span className="rank-move is-flat" title="No change since yesterday">&ndash;</span>;
  return (
    <span className={`rank-move ${d > 0 ? "is-up" : "is-down"}`} title={`Was No. ${before} yesterday`}>
      {d > 0 ? "▲" : "▼"}
      {Math.abs(d)}
    </span>
  );
}

/** Rank day by day, No. 1 at the top. One day is just a dot. */
export function Trend({ ranks, scale = 30 }: { ranks: number[]; scale?: number }) {
  if (!ranks.length) return null;
  const W = 76;
  const H = 24;
  const worst = Math.max(scale, ...ranks);
  const x = (i: number) => (ranks.length === 1 ? W - 3 : 3 + (i * (W - 6)) / (ranks.length - 1));
  const y = (rk: number) => 3 + ((rk - 1) / (worst - 1)) * (H - 6);
  const points = ranks.map((rk, i) => `${x(i).toFixed(1)},${y(rk).toFixed(1)}`).join(" ");
  const first = ranks[0];
  const last = ranks.at(-1)!;
  return (
    <svg
      className="rank-trend"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        ranks.length > 1 ? `From No. ${first} to No. ${last} over ${ranks.length} days` : `No. ${last}`
      }
    >
      {worst <= 60 && <line x1={0} x2={W} y1={y(25)} y2={y(25)} className="rank-trend-cut" />}
      {ranks.length > 1 && <polyline points={points} />}
      <circle cx={x(ranks.length - 1)} cy={y(last)} r={2.5} />
    </svg>
  );
}

/** The team's color as a CSS variable, for its row stripe. */
export function teamColor(color: string | null | undefined) {
  return color ? ({ ["--team" as string]: color } as React.CSSProperties) : undefined;
}


export function signed(n: number, places = 1) {
  return `${n > 0 ? "+" : ""}${n.toFixed(places)}`;
}

/** Value plus its D1 rank underneath, the way the shot chart shows vs D1. */
export function Stat({ value, rank }: { value: string; rank: number }) {
  return (
    <>
      {value}
      <span className="ratings-sub">{rank}</span>
    </>
  );
}

/** Why an outlier is here: it's elite at one thing. */
export function IdentityBadge({ label }: { label: string }) {
  return (
    <span
      className={`rank-badge ${
        label === "Elite offense" ? "is-offense" : label === "Elite defense" ? "is-defense" : "is-margins"
      }`}
    >
      {label}
    </span>
  );
}

/** "3-1", or nothing before a team has played. */
export function record(wins: number | undefined, losses: number | undefined) {
  return wins || losses ? `${wins ?? 0}-${losses ?? 0}` : "";
}

/** A team's spot in the AP poll, as a small tag. */
export function ApTag({ rank }: { rank: number | undefined }) {
  if (!rank) return null;
  return (
    <span className="rank-ap-tag" title="Associated Press Top 25. Not part of our formula">
      AP {rank}
    </span>
  );
}

/** Wherever the AP poll appears next to our numbers. */
export function ApDisclaimer() {
  return (
    <p className="rank-disclaimer">
      <strong>About the AP numbers:</strong> the AP Top 25 is the Associated
      Press&rsquo;s weekly poll of sportswriters, shown here for comparison
      only. It isn&rsquo;t ours, and it plays no part in our formula or our
      rankings.
    </p>
  );
}

const TABS = [
  { key: "top25", href: "/rankings", label: "Top 25" },
  { key: "all", href: "/rankings/all", label: "All teams" },
  { key: "conferences", href: "/rankings/conferences", label: "Conferences" },
  { key: "ap", href: "/rankings/ap", label: "AP Poll" },
] as const;

export type RankTab = (typeof TABS)[number]["key"];

/** Season line, title, lede and the tabs, the same on every rankings page. */
export function RankHeader({
  live,
  active,
  title,
  children,
}: {
  live: boolean;
  active: RankTab;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <header>
      <span className="rank-season">{live ? "2026–27 season" : "2026–27 preseason"}</span>
      <h1>{title}</h1>
      <p className="rank-lede">{children}</p>
      <nav className="rank-tabs" aria-label="Rankings">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={t.key === active ? "is-active" : ""}
            aria-current={t.key === active ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

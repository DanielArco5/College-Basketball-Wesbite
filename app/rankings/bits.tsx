import Link from "next/link";

/** Small pieces the ranking pages share. */

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

"use client";

import Link from "next/link";
import { useState } from "react";

export type RosterPlayer = {
  id: number;
  name: string;
  jersey: string | null;
  position: string | null;
  /** Where the name links: the player's chart, or null with no D1 shots. */
  href: string | null;
  /** Short context: shots that season, "Transfer from X", "New to D1". */
  note: string;
  /** Box-score totals that season for this team; null before he's played. */
  stats: RosterStats | null;
};

export type RosterStats = {
  games: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fgm: number;
  fga: number;
  three_m: number;
  three_a: number;
  ftm: number;
  fta: number;
};

const PER_GAME: [string, string, keyof RosterStats][] = [
  ["MIN", "Minutes per game", "minutes"],
  ["PTS", "Points per game", "points"],
  ["REB", "Rebounds per game", "rebounds"],
  ["AST", "Assists per game", "assists"],
  ["STL", "Steals per game", "steals"],
  ["BLK", "Blocks per game", "blocks"],
  ["TO", "Turnovers per game", "turnovers"],
];
const SPLITS: [string, string, keyof RosterStats, keyof RosterStats][] = [
  ["FG%", "Field goals", "fgm", "fga"],
  ["3P%", "Three-pointers", "three_m", "three_a"],
  ["FT%", "Free throws", "ftm", "fta"],
];
const pct = (made: number, att: number) => (att ? ((100 * made) / att).toFixed(1) : "—");

export type RosterSeason = { season: number; label: string; players: RosterPlayer[] };

/** A team's roster for each season, one tab per season. */
export default function Roster({
  seasons,
  initial,
}: {
  seasons: RosterSeason[];
  initial: number;
}) {
  const shown = seasons.filter((s) => s.players.length);
  const [season, setSeason] = useState(
    shown.some((s) => s.season === initial) ? initial : shown[0]?.season,
  );
  const current = shown.find((s) => s.season === season);
  if (!current) return null;

  return (
    <section className="roster" aria-label="Roster">
      <div className="roster-head">
        <h2>Roster</h2>
        <div className="roster-tabs" role="tablist">
          {shown.map((s) => (
            <button
              key={s.season}
              type="button"
              role="tab"
              aria-selected={s.season === season}
              className={s.season === season ? "on" : ""}
              onClick={() => setSeason(s.season)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="game-log roster-stats">
        <div className="game-log-scroll">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th title="Games played">GP</th>
                {PER_GAME.map(([label, title]) => (
                  <th key={label} title={title}>
                    {label}
                  </th>
                ))}
                {SPLITS.map(([label, title]) => (
                  <th key={label} title={title}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {current.players.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="roster-num">{p.jersey ? `#${p.jersey}` : ""}</span>
                    {p.href ? (
                      <Link href={p.href}>{p.name}</Link>
                    ) : (
                      <span className="roster-nolink">{p.name}</span>
                    )}
                    {p.position && <span className="roster-pos">{p.position}</span>}
                  </td>
                  {p.stats?.games ? (
                    <>
                      <td className="num">{p.stats.games}</td>
                      {PER_GAME.map(([label, , key]) => (
                        <td key={label} className="num">
                          {(p.stats![key] / p.stats!.games).toFixed(1)}
                        </td>
                      ))}
                      {SPLITS.map(([label, , made, att]) => (
                        <td key={label} className="num" title={`${p.stats![made]}/${p.stats![att]}`}>
                          {pct(p.stats![made], p.stats![att])}
                        </td>
                      ))}
                    </>
                  ) : (
                    <td className="roster-note" colSpan={1 + PER_GAME.length + SPLITS.length}>
                      {p.note}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="roster-foot">Per-game averages. Hover a percentage for makes and attempts.</p>
      </div>
    </section>
  );
}

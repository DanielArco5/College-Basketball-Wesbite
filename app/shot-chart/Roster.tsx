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
};

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
      <ul className="roster-list">
        {current.players.map((p) => (
          <li key={p.id}>
            <span className="roster-num">{p.jersey ? `#${p.jersey}` : ""}</span>
            <span className="roster-name">
              {p.href ? (
                <Link href={p.href}>{p.name}</Link>
              ) : (
                <span className="roster-nolink">{p.name}</span>
              )}
              {p.position && <span className="roster-pos">{p.position}</span>}
            </span>
            <span className="roster-note">{p.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

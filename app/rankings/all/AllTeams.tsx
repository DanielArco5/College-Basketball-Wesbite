"use client";

import Link from "next/link";
import { useState } from "react";
import { ApTag, IdentityBadge, LastGame, Move, NextGame, record, signed, Stat, teamColor, Trend } from "../bits";
import type { GameRef } from "@/lib/rankings";

export type TeamRow = {
  rk: number;
  team_id: number;
  school: string;
  conference: string | null;
  wins?: number;
  losses?: number;
  /** Points per 100 possessions better than an average D1 team. */
  rating: number;
  off_eff: number;
  oreb_pct: number;
  to_margin: number;
  three_pct: number;
  def_eff: number;
  ranks: { offense: number; oreb: number; turnovers: number; three: number; defense: number };
  identity: string | null;
  ap?: number;
  prev_rk: number | null;
  trend: number[];
  last_game: GameRef | null;
  next_game: GameRef | null;
  color: string | null;
  sos: number | null;
};

/**
 * Every rated team in formula order, filterable by conference and name,
 * re-ranked with the Top 25 every hour on game days.
 * The national rank stays put when filtered, so "#47 in the country"
 * still reads as 47.
 */
export default function AllTeams({ rows }: { rows: TeamRow[] }) {
  const [conf, setConf] = useState("");
  const [query, setQuery] = useState("");
  const conferences = [...new Set(rows.map((r) => r.conference ?? "Independent"))].sort();
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (!conf || (r.conference ?? "Independent") === conf) && (!q || r.school.toLowerCase().includes(q)),
  );

  return (
    <>
      <div className="rank-tools">
        <label>
          <span>Conference</span>
          <select value={conf} onChange={(e) => setConf(e.target.value)}>
            <option value="">All conferences</option>
            {conferences.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Team</span>
          <input
            type="search"
            value={query}
            placeholder="Search teams"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className="rank-tools-count">
          {shown.length === rows.length ? `${rows.length} teams` : `${shown.length} of ${rows.length} teams`}
        </span>
      </div>

      <div className="ratings-scroll">
        <table className="ratings rank-top">
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Team</th>
              <th
                scope="col"
                className="num is-sorted"
                title="Points per 100 possessions better than an average D1 team, on a neutral floor"
              >
                Rating
              </th>
              <th scope="col" title="Rank over the season">Trend</th>
              <th scope="col">Last game</th>
              <th scope="col">Next</th>
              <th scope="col" className="num" title="Strength of schedule: average opponent rating so far">SOS</th>
              <th scope="col" className="num" title="Points per 100 possessions">Off</th>
              <th scope="col" className="num" title="Points allowed per 100 possessions">Def</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const rec = record(r.wins, r.losses);
              return (
                <tr key={r.team_id} style={teamColor(r.color)}>
                  <td className="num ratings-rk">
                    <span className="rank-rk">{r.rk}</span>
                    <Move now={r.rk} before={r.prev_rk} />
                  </td>
                  <td className="rank-team">
                    <Link href={`/shot-chart?team=${r.team_id}`}>{r.school}</Link>
                    <ApTag rank={r.ap} />
                    <span className="ratings-team-conf">
                      {rec && `${rec} · `}
                      {r.conference ?? "Independent"}
                      {r.identity && <IdentityBadge label={r.identity} />}
                    </span>
                  </td>
                  <td className="num rank-rating">{signed(r.rating, 1)}</td>
                  <td>
                    <Trend ranks={r.trend} scale={rows.length} />
                  </td>
                  <td className="rank-game">
                    <LastGame game={r.last_game} />
                  </td>
                  <td className="rank-game">
                    <NextGame game={r.next_game} />
                  </td>
                  <td className="num">{r.sos == null ? "–" : signed(r.sos, 1)}</td>
                  <td className="num"><Stat value={r.off_eff.toFixed(1)} rank={r.ranks.offense} /></td>
                  <td className="num"><Stat value={r.def_eff.toFixed(1)} rank={r.ranks.defense} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="rank-note">No team matches.</p>}
      </div>
    </>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { ApTag, IdentityBadge, record, signed, Stat } from "../bits";

export type TeamRow = {
  rk: number;
  team_id: number;
  school: string;
  conference: string | null;
  wins?: number;
  losses?: number;
  score: number;
  off_eff: number;
  oreb_pct: number;
  to_margin: number;
  three_pct: number;
  def_eff: number;
  ranks: { offense: number; oreb: number; turnovers: number; three: number; defense: number };
  identity: string | null;
  ap?: number;
};

/**
 * Every rated team in formula order, filterable by conference and name.
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
        <table className="ratings">
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Team</th>
              <th scope="col" className="num is-sorted" title="Weighted score; 0 is a typical D1 team">
                Score
              </th>
              <th scope="col" className="num" title="Points per 100 possessions">Off</th>
              <th scope="col" className="num" title="Offensive rebound percentage">OREB%</th>
              <th scope="col" className="num" title="Turnovers forced minus committed, per 100 possessions">
                TO +/-
              </th>
              <th scope="col" className="num" title="Three-point percentage">3P%</th>
              <th scope="col" className="num" title="Points allowed per 100 possessions">Def</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const rec = record(r.wins, r.losses);
              return (
                <tr key={r.team_id}>
                  <td className="num ratings-rk">{r.rk}</td>
                  <td>
                    <Link href={`/shot-chart?team=${r.team_id}`}>{r.school}</Link>
                    <ApTag rank={r.ap} />
                    <span className="ratings-team-conf">
                      {rec && `${rec} · `}
                      {r.conference ?? "Independent"}
                      {r.identity && <IdentityBadge label={r.identity} />}
                    </span>
                  </td>
                  <td className="num">{signed(r.score, 2)}</td>
                  <td className="num"><Stat value={r.off_eff.toFixed(1)} rank={r.ranks.offense} /></td>
                  <td className="num"><Stat value={r.oreb_pct.toFixed(1)} rank={r.ranks.oreb} /></td>
                  <td className="num"><Stat value={signed(r.to_margin)} rank={r.ranks.turnovers} /></td>
                  <td className="num"><Stat value={r.three_pct.toFixed(1)} rank={r.ranks.three} /></td>
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

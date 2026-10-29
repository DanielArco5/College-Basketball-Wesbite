"use client";

import Link from "next/link";
import { useState } from "react";
import type { ApPoll } from "@/lib/ap";

function seasonLabel(season: number) {
  return `${season - 1}–${String(season).slice(2)}`;
}

/**
 * The AP Top 25, one tab per season: the live poll for the current
 * season, the final poll for finished ones. Each team links to its shot
 * chart for that season.
 */
export default function ApPolls({ polls }: { polls: ApPoll[] }) {
  const [season, setSeason] = useState(polls[0]?.season);
  const poll = polls.find((p) => p.season === season);
  if (!poll) return null;

  return (
    <section className="ap" aria-label="AP Top 25">
      <h2>AP Top 25</h2>
      <div className="ap-tabs" role="tablist">
        {polls.map((p) => (
          <button
            key={p.season}
            type="button"
            role="tab"
            aria-selected={p.season === season}
            className={p.season === season ? "on" : ""}
            onClick={() => setSeason(p.season)}
          >
            {seasonLabel(p.season)}
            <span className="ap-tab-note">{p.label}</span>
          </button>
        ))}
      </div>
      <ol className="ap-list">
        {poll.rows.map((r) => (
          <li key={r.rank + r.school}>
            <span className="ap-rk">{r.rank}</span>
            {r.team_id ? (
              <Link href={`/shot-chart?team=${r.team_id}&season=${poll.season}`}>{r.school}</Link>
            ) : (
              <span>{r.school}</span>
            )}
            {r.record && r.record !== "0-0" && <span className="ap-rec">{r.record}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

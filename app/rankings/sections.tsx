import Link from "next/link";
import { apRanks, getApPolls } from "@/lib/ap";
import type { Formula } from "@/lib/rankings";
import ApPolls from "./ApPoll";
import AllTeams, { type TeamRow } from "./all/AllTeams";
import { ApDisclaimer, ApTag, record, signed } from "./bits";

/**
 * The bodies of the rankings tabs (all teams, conferences, AP), shared by
 * the /rankings pages and the home page's tabs so both show the same thing.
 */

type Row = Formula["rows"][number];

/** Every rated team in formula order, filterable in the browser. */
export async function AllTeamsSection({ formula }: { formula: Formula }) {
  const ap = await apRanks();
  // Only what the table shows: the full rows carry transfers, weights and
  // more, which would bloat the page's data for nothing.
  const rows: TeamRow[] = formula.rows.map((r) => ({
    rk: r.rk,
    team_id: r.team_id,
    school: r.school,
    conference: r.conference,
    wins: r.wins,
    losses: r.losses,
    rating: r.rating ?? 0,
    off_eff: r.off_eff,
    oreb_pct: r.oreb_pct,
    to_margin: r.to_margin,
    three_pct: r.three_pct,
    def_eff: r.def_eff,
    ranks: r.ranks,
    identity: r.identity,
    ap: ap.get(r.team_id),
    prev_rk: r.prev_rk,
    trend: r.trend ?? [],
    last_game: r.last_game,
    next_game: r.next_game,
    color: r.color,
    sos: typeof r.sos === "number" ? r.sos : null,
  }));
  return (
    <>
      <AllTeams rows={rows} />
      <ApDisclaimer />
    </>
  );
}

/** Conference win share; ties broken by more wins, then our rating. */
function standing(a: Row, b: Row) {
  const pct = (r: Row) => {
    const g = (r.conf_wins ?? 0) + (r.conf_losses ?? 0);
    return g ? (r.conf_wins ?? 0) / g : 0;
  };
  return pct(b) - pct(a) || (b.conf_wins ?? 0) - (a.conf_wins ?? 0) || (b.rating ?? 0) - (a.rating ?? 0);
}

const slug = (conf: string) => conf.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Each league's conferences, strongest first. */
export function conferenceTables(formula: Formula) {
  const byConf = new Map<string, Row[]>();
  for (const r of formula.rows) {
    const conf = r.conference ?? "Independent";
    byConf.set(conf, [...(byConf.get(conf) ?? []), r]);
  }
  // Strongest league first, by its teams' average rating.
  const conferences = [...byConf.entries()]
    .map(([name, teams]) => {
      const started = teams.some((t) => (t.conf_wins ?? 0) + (t.conf_losses ?? 0) > 0);
      return {
        name,
        started,
        avg: teams.reduce((s, t) => s + (t.rating ?? 0), 0) / teams.length,
        teams: started ? [...teams].sort(standing) : teams,
      };
    })
    .sort((a, b) => b.avg - a.avg);
  return { conferences, anyStarted: conferences.some((c) => c.started) };
}

export async function ConferencesSection({ formula }: { formula: Formula }) {
  const ap = await apRanks();
  const { conferences } = conferenceTables(formula);

  return (
    <>
      <nav className="rank-conf-jump" aria-label="Jump to a conference">
        {conferences.map((c) => (
          <a key={c.name} href={`#${slug(c.name)}`}>
            {c.name}
          </a>
        ))}
      </nav>

      <ApDisclaimer />

      {conferences.map((c) => (
        <section key={c.name} id={slug(c.name)} className="rank-conf">
          <h2>
            {c.name}
            <span className="rank-conf-meta">
              {c.teams.length} teams · average rating {signed(c.avg, 1)}
              {!c.started && " · by our rating until league play starts"}
            </span>
          </h2>
          <div className="ratings-scroll">
            <table className="ratings rank-conf-table">
              <thead>
                <tr>
                  <th scope="col" className="num">#</th>
                  <th scope="col">Team</th>
                  <th scope="col" className={`num${c.started ? " is-sorted" : ""}`} title="Conference record">
                    Conf
                  </th>
                  <th scope="col" className="num" title="Overall record">Overall</th>
                  <th scope="col" className="num" title="Our national rank, out of all Division I teams">
                    Nat&rsquo;l
                  </th>
                  <th
                    scope="col"
                    className={`num${c.started ? "" : " is-sorted"}`}
                    title="Points per 100 possessions better than an average D1 team"
                  >
                    Rating
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.teams.map((t, i) => (
                  <tr key={t.team_id}>
                    <td className="num ratings-rk">{i + 1}</td>
                    <td>
                      <Link href={`/shot-chart?team=${t.team_id}`}>{t.school}</Link>
                      <ApTag rank={ap.get(t.team_id)} />
                    </td>
                    <td className="num">{record(t.conf_wins, t.conf_losses) || "0-0"}</td>
                    <td className="num ratings-overall">{record(t.wins, t.losses) || "0-0"}</td>
                    <td className="num ratings-rk">#{t.rk}</td>
                    <td className="num">{signed(t.rating ?? 0, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

export async function ApSection() {
  const polls = await getApPolls([2027, 2026]);
  return (
    <>
      <ApDisclaimer />
      <ApPolls polls={polls} />
    </>
  );
}

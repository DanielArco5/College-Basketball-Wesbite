import Link from "next/link";
import { apRanks } from "@/lib/ap";
import { getRanking, type Formula } from "@/lib/rankings";
import { ApDisclaimer, ApTag, RankHeader, record, signed } from "../bits";
import "../rankings.css";

export const metadata = {
  title: "Conference rankings",
  description: "Every Division I conference, team by team: standings once league play starts, our rating until then.",
};

export const revalidate = 300;

type Row = Formula["rows"][number];

/** Conference win share; ties broken by more wins, then our rating. */
function standing(a: Row, b: Row) {
  const pct = (r: Row) => {
    const g = (r.conf_wins ?? 0) + (r.conf_losses ?? 0);
    return g ? (r.conf_wins ?? 0) / g : 0;
  };
  return pct(b) - pct(a) || (b.conf_wins ?? 0) - (a.conf_wins ?? 0) || (b.rating ?? 0) - (a.rating ?? 0);
}

const slug = (conf: string) => conf.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default async function ConferencesPage() {
  const [{ formula }, ap] = await Promise.all([getRanking(), apRanks()]);

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
  const anyStarted = conferences.some((c) => c.started);

  return (
    <main className="rank">
      <RankHeader live={formula.stage === "in-season"} active="conferences" title="Conferences">
        {anyStarted
          ? "Each league's standings by conference record, with our national rank and rating alongside. Leagues that haven't started conference play are ordered by our rating."
          : "Conference play hasn't started yet. Until it does, each league is ordered by our rating; once teams play league games, it switches to standings by conference record."}{" "}
        Leagues are listed strongest first, by their teams&rsquo; average rating.
      </RankHeader>

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
    </main>
  );
}
